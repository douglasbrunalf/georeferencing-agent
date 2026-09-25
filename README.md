# Agente de Georeferenciación

POC de un agente de IA que normaliza y optimiza direcciones colombianas mal escritas o incompletas para mejorar su precisión de geocodificación, con una cascada de proveedores de mapas (HERE → Google Maps), guardrails contra alucinación, y una interfaz web para carga individual/masiva, visualización en mapa, historial y administración de usuarios.

> Documentación complementaria en [`docs/`](docs/): [manual de usuario](docs/Manual-Usuario-Agente-Georeferenciacion.docx) y [diagrama de arquitectura AWS](docs/geoagent-architecture.drawio) (editable en [draw.io](https://app.diagrams.net)).

## Tabla de contenidos

- [Qué hace](#qué-hace)
- [Cómo funciona](#cómo-funciona)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Requisitos previos](#requisitos-previos)
- [Instalación y desarrollo local](#instalación-y-desarrollo-local)
- [Variables de entorno](#variables-de-entorno)
- [Despliegue en AWS](#despliegue-en-aws)
- [Límites conocidos de la POC](#límites-conocidos-de-la-poc)

## Qué hace

1. El usuario ingresa una dirección (individual o en archivo CSV/JSON masivo) desde la web.
2. El sistema la geocodifica de entrada contra **HERE** y le asigna un puntaje de precisión (0–100%).
3. Si la precisión es baja, el usuario puede enviarla a un **agente de IA (Amazon Nova Lite, vía Bedrock)** que la reescribe: corrige ortografía, expande abreviaturas, reordena componentes — sin inventar datos que no estaban en el texto original.
4. La dirección reescrita se vuelve a geocodificar con una cascada **HERE → Google Maps**, escalando al siguiente proveedor solo si el anterior no alcanza un umbral de precisión aceptable.
5. Un **guardrail de Bedrock** valida que la reescritura esté fundamentada en el texto original (contextual grounding); si la bloquea, se reintenta una vez pidiéndole a la IA una copia literal antes de marcarla como fallida.
6. El resultado (precisión antes/después, coordenadas, nivel de detalle, texto optimizado) queda guardado y es consultable, exportable (CSV/JSON) y visualizable en un mapa (pines o densidad por zona).

## Cómo funciona

- **Modelo de IA**: Amazon Nova Lite (`us.amazon.nova-lite-v1:0`) vía Bedrock Converse API, elegido por límites de cuota de la cuenta (200 RPM cross-region vs. 25 RPM de Nova Pro; los modelos Anthropic están bloqueados en esta cuenta).
- **Procesamiento por lotes**: Step Functions Distributed Map agrupa direcciones en lotes de 8 (`ItemBatcher`) con `maxConcurrency: 8`, es decir hasta 64 direcciones procesándose en paralelo por llamada al agente.
- **Cascada de geocodificación**: HERE `/geocode` primero; si el puntaje ya es suficiente, no se llama a `/autosuggest` (optimización de velocidad). Si sigue por debajo del umbral, se escala a Google Maps Geocoding como último recurso.
- **Guardrails**: filtros de contenido, temas denegados y verificación de contextual grounding de Amazon Bedrock Guardrails, con reintento automático de una sola vez.
- **Autenticación**: Amazon Cognito, sin auto-registro público — las cuentas solo las crea un administrador ya autenticado (dominio `@cnid.co`) desde el propio panel de la app, con contraseña temporal y cambio obligatorio en el primer ingreso.

## Arquitectura

Diagrama completo (con íconos oficiales de AWS) en [`docs/geoagent-architecture.drawio`](docs/geoagent-architecture.drawio). Resumen de los componentes principales:

| Capa | Servicio AWS | Rol |
|---|---|---|
| Frontend | AWS Amplify Hosting | Sirve la SPA Next.js |
| Edge / API | Amazon CloudFront + Application Load Balancer | HTTPS público frente al backend |
| Cómputo | Amazon ECS Fargate | API (Fastify) en subredes privadas aisladas, **sin NAT Gateway ni salida a internet** |
| Identidad | Amazon Cognito | User Pool, alta de usuarios solo vía `AdminCreateUser` |
| Orquestación | AWS Step Functions | Distributed Map (validación) y Map por lotes (normalización) |
| Procesamiento | AWS Lambda (Node 22, ARM64) | `HereGeocodeFunction` y `NormalizeAddressFunction` |
| IA | Amazon Bedrock (Nova Lite + Guardrails) | Normalización de direcciones con validación anti-alucinación |
| Datos | Amazon DynamoDB, Amazon S3, AWS Secrets Manager | Jobs/direcciones, archivos de carga masiva, claves de HERE/Google |
| Red | VPC con Gateway/Interface Endpoints | Conectividad privada a AWS sin NAT Gateway |
| Externos | HERE Maps API, Google Maps Geocoding API | Proveedores de geocodificación |

La API de ECS Fargate corre en subredes `PRIVATE_ISOLATED` sin salida a internet por diseño: todo lo que necesita (DynamoDB, S3, Step Functions, Secrets Manager, ECR, CloudWatch Logs, Cognito IDP) lo alcanza vía VPC Endpoints. Las Lambdas sí corren con la red por defecto (fuera de la VPC) porque necesitan salir a internet para llamar a HERE, Google y Bedrock.

## Estructura del repositorio

Monorepo con npm workspaces:

```
georeferencing-agent/
├── apps/
│   ├── web/              # Frontend Next.js 16 + shadcn/ui (Amplify Hosting)
│   └── api/               # Backend Fastify (ECS Fargate)
├── services/
│   ├── lambdas/
│   │   ├── here-geocode/          # Geocodificación inicial (HERE)
│   │   ├── normalize-address/     # Agente IA + guardrail + cascada de geocoding
│   │   └── pre-signup/             # Trigger de Cognito: valida dominio @cnid.co
│   └── shared/            # Código compartido entre Lambdas
├── infra/                 # AWS CDK (TypeScript) — infraestructura como código
│   ├── bin/infra.ts       # Entry point: instancia todos los stacks
│   └── lib/
│       ├── network-stack.ts     # VPC, subredes, VPC endpoints
│       ├── data-stack.ts        # DynamoDB, S3
│       ├── agent-stack.ts       # Bedrock Guardrail
│       ├── auth-stack.ts        # Cognito User Pool
│       ├── processing-stack.ts  # Step Functions + Lambdas
│       └── api-stack.ts         # ECS Fargate, ALB, CloudFront
├── docs/                  # Manual de usuario y diagrama de arquitectura
└── amplify.yml             # Config de build de AWS Amplify para apps/web
```

## Requisitos previos

- Node.js ≥ 20 y npm ≥ 10
- Una cuenta de AWS con acceso a Bedrock (modelo Nova Lite habilitado), Cognito, DynamoDB, S3, Step Functions, ECS/Fargate y Secrets Manager
- AWS CLI configurado (`aws configure` o SSO) con permisos de administrador para desplegar
- AWS CDK v2 (`infra/` ya lo trae como devDependency; se invoca vía `npm run cdk` o `npx cdk`)
- Docker (para construir la imagen del backend al desplegar `GeoAgent-Api` — CDK la empaqueta y publica en ECR)
- Claves de API de HERE y de Google Maps Geocoding, cargadas como secretos en AWS Secrets Manager antes del primer despliegue de `GeoAgent-Processing`:
  - `georeferencing-agent/here-api-key`
  - `georeferencing-agent/google-maps-api-key`

## Instalación y desarrollo local

```bash
git clone https://github.com/sebastianym/georeferencing-agent.git
cd georeferencing-agent
npm install   # instala todos los workspaces (apps/web, apps/api, infra, services/*)
```

### Frontend (`apps/web`)

```bash
npm run dev --workspace=web
```

Requiere `apps/web/.env.local` (no versionado) con las variables listadas en la sección siguiente. Corre en `http://localhost:3000` por defecto.

### Backend (`apps/api`)

```bash
npm run dev --workspace=@georeferencing-agent/api
```

El backend local llama a recursos reales de AWS (DynamoDB, S3, Step Functions, Cognito), así que necesita credenciales de AWS válidas en el entorno (`aws sso login` o variables `AWS_*`) y las variables de entorno de la tabla siguiente apuntando a los recursos ya desplegados. Corre en `http://localhost:8080` por defecto (`PORT`).

### Infraestructura (`infra`)

```bash
cd infra
npm run build     # compila TypeScript
npx cdk diff       # revisa cambios antes de desplegar
npx cdk deploy --all
```

## Variables de entorno

### Frontend — `apps/web/.env.local`

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL pública de la API (CloudFront delante del ALB) |
| `NEXT_PUBLIC_HERE_API_KEY` | API key de HERE usada por el mapa en el navegador (distinta de la que usan las Lambdas) |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Client ID del User Pool de Cognito, para login directo (SRP) desde el navegador |
| `NEXT_PUBLIC_AWS_REGION` | Región de Cognito (por defecto `us-east-1`) |

### Backend — `apps/api` (inyectadas por ECS/CDK en producción)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP del servidor Fastify (por defecto `8080`) |
| `JOBS_TABLE` / `ADDRESSES_TABLE` | Nombres de las tablas DynamoDB |
| `DATA_BUCKET` | Bucket S3 para archivos de carga masiva |
| `VALIDATION_STATE_MACHINE_ARN` / `NORMALIZATION_STATE_MACHINE_ARN` | ARNs de las state machines de Step Functions |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | Para verificar los JWT entrantes |
| `ADMIN_EMAIL_DOMAIN` | Dominio permitido para que un usuario cree cuentas nuevas (`cnid.co`) |

### Lambdas — `services/lambdas/*` (inyectadas por CDK)

| Variable | Lambda | Descripción |
|---|---|---|
| `HERE_SECRET_ARN` | `here-geocode`, `normalize-address` | ARN del secreto con la API key de HERE |
| `GOOGLE_MAPS_SECRET_ARN` | `normalize-address` | ARN del secreto con la API key de Google Maps |
| `BEDROCK_MODEL_ID` | `normalize-address` | ID del modelo de Bedrock (Nova Lite) |
| `GUARDRAIL_ID` / `GUARDRAIL_VERSION` | `normalize-address` | Guardrail de Bedrock a aplicar |
| `ALLOWED_EMAIL_DOMAIN` | `pre-signup` | Dominio permitido en el trigger de Cognito |

## Despliegue en AWS

La infraestructura está dividida en stacks de CDK independientes, con dependencias entre ellos (instanciados en ese orden en `infra/bin/infra.ts`):

1. **`GeoAgent-Network`** — VPC, subredes públicas/privadas, VPC endpoints (sin NAT Gateway)
2. **`GeoAgent-Data`** — Tablas DynamoDB (Jobs, Addresses) y bucket S3
3. **`GeoAgent-Agent`** — Guardrail de Bedrock
4. **`GeoAgent-Auth`** — Cognito User Pool + trigger PreSignUp
5. **`GeoAgent-Processing`** — Step Functions + Lambdas (depende de Data y Agent)
6. **`GeoAgent-Api`** — ECS Fargate + ALB + CloudFront (depende de Network, Data, Processing y Auth)

```bash
cd infra
npx cdk deploy --all
```

El **frontend** (`apps/web`) se despliega por separado en **AWS Amplify Hosting**, conectado al repositorio de GitHub con build automático en cada push a `main` (config en [`amplify.yml`](amplify.yml)).

## Límites conocidos de la POC

| Límite | Valor actual | Dónde |
|---|---|---|
| Filas por archivo de carga masiva | 5,000 | `apps/api/src/routes/jobs.ts` |
| Tamaño máximo de archivo | 10 MB | `apps/api/src/server.ts` |
| Formatos de archivo aceptados | CSV, JSON | `apps/api/src/lib/parse-file.ts` |

Son topes conservadores definidos para esta etapa del proyecto, no restricciones técnicas de AWS — se pueden ajustar según el volumen real que necesite el cliente.
