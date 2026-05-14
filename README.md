<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## API contracts

Export the current OpenAPI document without starting the HTTP server:

```bash
npm run openapi:export -- --output=runtime/openapi.json
```

Regenerate frontend API clients from that file:

```bash
# storefront
cd ../frontend
$env:ORVAL_OPENAPI_URL="C:/Users/krush/Desktop/www/catalog/backend/runtime/openapi.json"
bun run api:gen

# platform dashboard
cd ../dashboard
$env:ORVAL_OPENAPI_URL="C:/Users/krush/Desktop/www/catalog/backend/runtime/openapi.json"
bun run api:gen
```

## Observability

LGTM overlay is started with a separate Compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Collector-only mode for a split deployment is available too:

```bash
docker compose -f docker-compose.observability.collector.yml up -d
```

Ready-made split deployment environment templates:

- backend host: `.env.observability.backend-host.example`
- observability host: `.env.observability.remote-host.example`

After startup:

- Grafana: `http://localhost:3001`
- Metrics endpoint backend: `http://localhost:4000/metrics`
- OTLP traces endpoint: `http://localhost:4318/v1/traces`
- Backend logs file: `runtime/logs/backend.jsonl`

Available dashboards:

- `Backend Overview`
- `Auth Overview`
- `Operations Overview`
- `Integration Health`
- `Order Export Health`
- `Inventory Health`

Dashboard JSON files are provisioned from `ops/observability/grafana/dashboards` into the Grafana `Application` folder.

Domain dashboard metrics:

- `Integration Health`: `catalog_backend_integration_sync_runs_total`, `catalog_backend_integration_sync_duration_seconds`, `catalog_backend_integration_sync_items_total`, `catalog_backend_queue_jobs_total{queue="moysklad-sync"}`
- `Order Export Health`: `catalog_backend_order_export_events_total`, `catalog_backend_queue_jobs_total{queue="order-export"}`, `catalog_backend_queue_job_duration_seconds{queue="order-export"}`
- `Inventory Health`: `catalog_backend_inventory_movements_total`, `catalog_backend_integration_stock_stale_age_seconds`, `catalog_backend_integration_sync_items_total{entity="stock_row"}`, `catalog_backend_queue_jobs_total{queue="moysklad-sync",job_name="stock-sync"}`

The backend process itself should be running separately on the host so Alloy can scrape metrics from `http://localhost:4000/metrics` and receive traces through `http://localhost:4318/v1/traces`.

Observability environment template: `.env.observability.example`.

Set `OBSERVABILITY_ENABLED=false` to disable application-side metrics, traces, JSON log export, and HTTP observability without removing the code or Docker overlay.

For a split deployment:

- run `grafana`, `loki`, `tempo`, and `mimir` on the observability host
- run `alloy` from `docker-compose.observability.collector.yml` on the backend host
- point `OBSERVABILITY_TEMPO_OTLP_ENDPOINT`, `OBSERVABILITY_MIMIR_REMOTE_WRITE_URL`, and `OBSERVABILITY_LOKI_WRITE_URL` to the remote observability host
- keep `OBSERVABILITY_OTLP_TRACES_URL` in the backend pointed at the local Alloy endpoint, usually `http://localhost:4318/v1/traces`
- expose `3100`, `4317`, `4318`, and `9009` only to the backend host IP, not to the whole internet

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Mysliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
