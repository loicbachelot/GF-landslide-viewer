# CI/CD — Ground Failure Landslide Viewer

## Overview

Automated CI/CD pipeline with dev/prod environment separation. All workflows use OIDC authentication (no stored AWS keys) and branch protection enforces code review before production changes.

| Environment | Branch | Deploy | URL |
|---|---|---|---|
| Dev | `dev` | Auto on push | `https://ground-failure.cascadiaquakes.org/dev/index.html` |
| Prod | `master` | Manual | `https://ground-failure.cascadiaquakes.org/` |

---

## Workflows

```
.github/workflows/
├── ci.yml                    # PR validation (frontend build + CDK synth)
├── deploy-frontend.yml       # Production frontend deploy (manual)
├── deploy-frontend-dev.yml   # Dev frontend deploy (auto on push to dev)
└── deploy-infra.yml          # CDK infrastructure deploy (manual)
```

**CI** runs automatically on every pull request to `master` or `dev`. It validates the frontend build and CDK synth. No AWS credentials required.

**Deploy Frontend** is triggered manually from Actions with a confirmation gate — type `deploy` to proceed. This prevents accidental production changes.

**Deploy Frontend (Dev)** triggers automatically when frontend files are pushed to the `dev` branch.

**Deploy Infrastructure** runs `cdk diff` followed by `cdk deploy`. This handles the entire backend — ECS Fargate (Martin), RDS (PostGIS), Lambda functions, API Gateway, SQS, DynamoDB, and CloudFront. Use with caution and always review the diff output before proceeding.

---

## Development Workflow

**Frontend changes:**

```
git checkout dev
git checkout -b feature/my-change
# make changes, commit, push
# open PR to dev → CI runs → merge → auto-deploys to dev
# preview at /dev/index.html
# open PR from dev → master → CI runs → merge
# Actions → Deploy Frontend → type "deploy" → live
```

**Backend changes** (Lambda code, ECS config, CDK stack) follow the same branch flow, but trigger **Deploy Infrastructure** instead of Deploy Frontend after merging to `master`.

---

## Infrastructure

| Component | Resource |
|---|---|
| Frontend (prod) | `s3://crescent-react-hosting/landslide-viewer/` |
| Frontend (dev) | `s3://crescent-react-hosting/landslide-viewer/dev/` |
| CloudFront | `E1GKP873FE1A6V` → `ground-failure.cascadiaquakes.org` |
| CDK Stack | `LandslideStack` |

**Backend services** (fully serverless, managed by CDK):
- **Martin** — ECS Fargate tile server, image from ECR (`martin`)
- **PostGIS** — RDS PostgreSQL 16.11 (private subnet)
- **Download API** — Lambda + API Gateway (`/api/download`, `/api/count`)
- **Download Worker** — Lambda triggered by SQS, writes exports to S3
- **Landslide Details** — Lambda (`/api/landslide`)
- **Job Tracking** — DynamoDB with TTL
- **Export Storage** — S3 bucket with 1-day lifecycle

---

## Repository Configuration

**No GitHub Secrets required.** The frontend uses OpenStreetMap tiles and self-hosted Martin so no API keys needed.

**IAM:**
- `GitHubActionsDeployRole` trusts `cascadiaquakes/GF-landslide-viewer` on `master`, `dev`, and `main` branches via OIDC
- Role has `AdministratorAccess` for CDK deployments

**Branch Protection** on `master`:
- Requires pull request
- Requires CI status check to pass