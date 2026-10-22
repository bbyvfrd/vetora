# Modules

One folder per bounded context in `docs/domain.md` §6, created by the slice that first needs it (the data model feature adds the schema skeleton for all thirteen). Modules reach each other only through their public interface or domain events, never through each other's tables; only `src/platform/` may import a database client (spec 0001, "Repository layout").

| Folder | Context |
|---|---|
| `clinical-record/` | Clinical Record |
| `hospitalization/` | Hospitalization |
| `prescription-dispensing/` | Prescription & Dispensing |
| `client/` | Client |
| `patient/` | Patient |
| `scheduling/` | Scheduling & Resources |
| `diagnostics/` | Diagnostics |
| `inventory/` | Inventory |
| `billing/` | Billing & Payments |
| `non-clinical-services/` | Non-Clinical Services |
| `preventive-care/` | Preventive Care |
| `client-communication/` | Client Communication |
| `identity-access/` | Identity & Access |
