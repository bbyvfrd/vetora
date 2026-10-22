#!/usr/bin/env bash
# How the DigitalOcean resources for one environment are created (spec 0001, "Infrastructure as a script").
# The console is for reading; every change goes through here so it can be repeated for production.
#
# Status: written with the scaffold, NOT YET RUN. Run it step by step the first time, from your laptop,
# with doctl signed in (`doctl auth init`). Needs: doctl, psql (matching the server major), openssl.
#
# Usage: ENVIRONMENT=staging ./infra/digitalocean.sh <step>
# Steps, in order: database | roles | droplet | firewall | dns | summary
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"      # staging | production
REGION="${REGION:-fra1}"                    # Frankfurt (spec 0001, "Hosting", "Data location and compliance")
PG_VERSION="${PG_VERSION:-18}"              # check: doctl databases options versions --engine pg
DB_CLUSTER="vetora-${ENVIRONMENT}-db"
DB_SIZE="${DB_SIZE:-db-s-1vcpu-1gb}"
DROPLET="vetora-${ENVIRONMENT}"
DROPLET_SIZE="${DROPLET_SIZE:-s-1vcpu-2gb}"
DROPLET_IMAGE="ubuntu-24-04-x64"
DOMAIN="${DOMAIN:?set DOMAIN, e.g. vetora.example (registered at online.az, DNS hosted at DigitalOcean)}"
HOSTNAME_PREFIX=$([ "$ENVIRONMENT" = production ] && echo app || echo staging)
SSH_KEY_NAME="${SSH_KEY_NAME:?set SSH_KEY_NAME to the name of your public key in DigitalOcean (doctl compute ssh-key list)}"
STATE_DIR="infra/.state"                    # ids and generated passwords land here; git ignores it
mkdir -p "$STATE_DIR"

step="${1:-summary}"

cluster_id() { doctl databases list --format ID,Name --no-header | awk -v n="$DB_CLUSTER" '$2 == n {print $1}'; }
droplet_id() { doctl compute droplet list --format ID,Name --no-header | awk -v n="$DROPLET" '$2 == n {print $1}'; }
droplet_ip() { doctl compute droplet get "$(droplet_id)" --format PublicIPv4 --no-header; }

case "$step" in
  database)
    # Managed Postgres with its pooler. A Standard cluster has no standby node after 2026-11-30;
    # add one (Advanced cluster) before real client data arrives (spec 0001, "Backups and recovery").
    if [ -z "$(cluster_id)" ]; then
      doctl databases create "$DB_CLUSTER" --engine pg --version "$PG_VERSION" --region "$REGION" --size "$DB_SIZE" --num-nodes 1 --wait
    fi
    id="$(cluster_id)"; echo "$id" > "$STATE_DIR/$ENVIRONMENT.db-cluster-id"
    doctl databases get "$id" --format Name,Status,Region,Version
    ;;

  roles)
    # The vetora database (UTF8, ICU root collation) and the three base roles, as doadmin.
    # Mirrors infra/postgres/init/01-vetora.sql (local); keep the two in step.
    id="$(cat "$STATE_DIR/$ENVIRONMENT.db-cluster-id")"
    admin_uri="$(doctl databases connection "$id" --format URI --no-header)"
    for role in migrator app backup; do
      f="$STATE_DIR/$ENVIRONMENT.vetora_${role}.password"
      [ -f "$f" ] || openssl rand -base64 30 | tr -d '/+=' > "$f"
    done
    psql "$admin_uri" -v ON_ERROR_STOP=1 \
      -v migrator_password="$(cat "$STATE_DIR/$ENVIRONMENT.vetora_migrator.password")" \
      -v app_password="$(cat "$STATE_DIR/$ENVIRONMENT.vetora_app.password")" \
      -v backup_password="$(cat "$STATE_DIR/$ENVIRONMENT.vetora_backup.password")" <<'SQL'
CREATE ROLE vetora_migrator LOGIN PASSWORD :'migrator_password' CREATEROLE;
CREATE ROLE vetora_app LOGIN PASSWORD :'app_password';
CREATE ROLE vetora_backup LOGIN PASSWORD :'backup_password';
CREATE DATABASE vetora ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0;
ALTER DATABASE vetora SET timezone TO 'UTC';
REVOKE CONNECT ON DATABASE vetora FROM PUBLIC;
GRANT CONNECT ON DATABASE vetora TO vetora_migrator, vetora_app, vetora_backup;
GRANT CREATE ON DATABASE vetora TO vetora_migrator;
\connect vetora
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO vetora_migrator, vetora_app, vetora_backup;
SQL
    # The pooler in transaction mode carries request traffic for the app role (spec 0001, "Connections").
    doctl databases pool create "$id" vetora-app --db vetora --mode transaction --size 10 --user vetora_app
    echo "DATABASE_URL_POOLED: $(doctl databases pool get "$id" vetora-app --format URI --no-header)"
    echo "DATABASE_URL_DIRECT / MIGRATOR / BACKUP: take the cluster's direct host and port from"
    echo "  doctl databases connection $id  and use the vetora_<role> credentials from $STATE_DIR"
    ;;

  droplet)
    # One droplet per environment runs kamal-proxy, the api, and the web service (worker joins in slice 6).
    # cloud-init creates the key only `deploy` user Kamal connects as and turns on automatic security updates.
    key_id="$(doctl compute ssh-key list --format ID,Name --no-header | awk -v n="$SSH_KEY_NAME" '$2 == n {print $1}')"
    pubkey="$(doctl compute ssh-key get "$key_id" --format PublicKey --no-header)"
    if [ -z "$(droplet_id)" ]; then
      doctl compute droplet create "$DROPLET" --region "$REGION" --size "$DROPLET_SIZE" --image "$DROPLET_IMAGE" \
        --ssh-keys "$key_id" --enable-monitoring --tag-names "vetora,$ENVIRONMENT" --wait \
        --user-data "$(cat <<CLOUDINIT
#cloud-config
users:
  - name: deploy
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - $pubkey
package_update: true
packages: [unattended-upgrades]
runcmd:
  - [sed, -i, 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/', /etc/ssh/sshd_config]
  - [systemctl, restart, ssh]
  - [dpkg-reconfigure, -f, noninteractive, unattended-upgrades]
CLOUDINIT
)"
    fi
    echo "$(droplet_id)" > "$STATE_DIR/$ENVIRONMENT.droplet-id"
    echo "Droplet $DROPLET at $(droplet_ip). Next: kamal server bootstrap -c apps/api/config/deploy.yml -d $ENVIRONMENT (installs Docker)."
    ;;

  firewall)
    # The database accepts connections only from the droplet (and your laptop while you provision).
    doctl databases firewalls append "$(cat "$STATE_DIR/$ENVIRONMENT.db-cluster-id")" --rule "droplet:$(droplet_id)"
    doctl compute firewall create --name "vetora-$ENVIRONMENT" --droplet-ids "$(droplet_id)" \
      --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
      --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"
    ;;

  dns)
    # One host per environment, app at / and API at /api on the same origin (spec 0001, "Domain and DNS").
    doctl compute domain create "$DOMAIN" 2>/dev/null || true
    doctl compute domain records create "$DOMAIN" --record-type A --record-name "$HOSTNAME_PREFIX" --record-data "$(droplet_ip)" --record-ttl 300
    echo "Host: $HOSTNAME_PREFIX.$DOMAIN -> $(droplet_ip). Put it in apps/*/config/deploy.$ENVIRONMENT.yml"
    ;;

  summary)
    echo "Environment: $ENVIRONMENT ($REGION)"
    echo "Cluster:  $(cluster_id || true)"
    echo "Droplet:  $(droplet_id || true) $(droplet_ip 2>/dev/null || true)"
    echo "Not scripted yet (arrive with their slices): Spaces bucket and keys (slice 6), alerts and uptime check (slice 7)."
    ;;

  *)
    echo "unknown step: $step (database | roles | droplet | firewall | dns | summary)" >&2; exit 2
    ;;
esac
