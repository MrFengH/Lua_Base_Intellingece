# Lua

![Lua](assets/banner_lua.png)

**Inteligencia local para observaciones hospitalarias**

Una aplicación de escritorio local-first que transforma el relato en texto libre de un colega de
campo sobre una visita a un hospital en un registro estructurado y basado en evidencia del equipo
médico que observó — MR, CT, ultrasonido, rayos X, monitoreo de pacientes y terapia guiada por
imagen. Toda la extracción se ejecuta localmente, en el dispositivo, mediante
[QVAC](https://docs.qvac.tether.io/).

Este repositorio es un prototipo de hackathon, no un sistema médico o de gestión de activos en
producción. No contiene datos reales de pacientes, hospitales o productos Philips — todo en él es
sintético por construcción.

## El problema

Los colegas de campo que visitan hospitales observan rutinariamente la base instalada de equipo
médico — qué hay, más o menos qué tan antiguo es, quién lo fabricó — pero ese conocimiento suele
quedar como una nota sin estructurar, o en la memoria de alguien. Convertirlo hoy en un registro de
base instalada utilizable y consultable implica captura manual de datos, lo cual es lento,
inconsistente y propenso a sobrescribir silenciosamente lo que realmente se dijo con lo que un
formulario exigía.

## La solución

Un flujo de captura conversacional que:

- acepta un relato en texto libre de una visita, en inglés o español;
- extrae un borrador estructurado localmente, hace una pregunta de seguimiento determinista a la
  vez por cada dato faltante, y nunca convierte una duda ("tal vez tenga ocho años") en un hecho
  con certeza total;
- permite al observador corregir y confirmar explícitamente el resultado estructurado antes de
  guardar nada;
- guarda la observación como **evidencia de solo anexado (append-only)** — las correcciones y
  visitas posteriores nunca sobrescriben ni eliminan lo que se dijo, se agregan al registro;
- proyecta esa evidencia en una vista **Customer 360** por instalación, con confianza, procedencia
  y trazabilidad hasta la redacción original de cada campo;
- marca reportes probablemente duplicados o corroborantes entre visitas para que un humano los
  resuelva, y nunca fusiona registros automáticamente;
- consolida la proyección en un **Dashboard** local por modalidad y país.

## Por qué en el dispositivo / QVAC

Las observaciones hospitalarias — nombres de instalaciones, detalles de equipos, quién reportó
qué — son sensibles por naturaleza y a menudo se registran donde la conectividad es pobre o nula.
Enviar ese texto a un proveedor de IA en la nube es tanto un riesgo de privacidad como de
disponibilidad. QVAC ejecuta el modelo de extracción directamente en la máquina del usuario
mediante `@qvac/sdk`, de modo que:

- ningún texto de observación cruza jamás la red;
- la captura y la extracción siguen funcionando en modo avión una vez que el modelo está guardado
  localmente en caché;
- no hay ningún proveedor de IA en la nube en todo el grafo de dependencias, ni un respaldo
  silencioso hacia uno.

Consulta [docs/PRIVACY_OFFLINE.md](docs/PRIVACY_OFFLINE.md) para el modelo de amenazas completo y
el poco tráfico de red que sí existe (solo la obtención del modelo).

## Capacidades principales

- Captura conversacional de texto con manejo explícito de `Unknown` — un desconocido declarado
  nunca se adivina, y la misma pregunta no se hace dos veces.
- Revisión y corrección estructurada antes de guardar; nada se guarda sin una confirmación humana
  explícita de un resumen en lenguaje simple.
- Múltiples grupos de equipos en una misma visita, incluyendo distintas modalidades y distintas
  antigüedades dentro de la misma modalidad.
- Una contradicción dentro de una misma captura (p. ej. "era NovaMed... en realidad, tal vez
  Orion") se presenta como pregunta, nunca se resuelve silenciosamente por el orden de los
  mensajes.
- Persistencia transaccional en SQLite de cliente, sesión, evidencia, equipo, procedencia,
  confianza y candidatos duplicados.
- Proyección Customer 360 con evidencia de respaldo, confianza e IDs de observación trazables.
- Revisión humana de candidatos duplicados/corroborantes con evidencia lado a lado y resoluciones
  persistidas (`NotDuplicate`, `SameEquipment`, `CorroboratingEvidence`) — nunca una fusión
  automática.
- Dashboard local por modalidad y país, más un contador de observaciones incompletas.
- Un adaptador real de inferencia en el dispositivo con QVAC, y un mock de desarrollo determinista
  claramente etiquetado para poder ejercitar el flujo sin descargar un modelo. El mock es un
  **adaptador determinista de desarrollo/pruebas; no es válido como demo final de QVAC**, y la
  interfaz siempre muestra qué motor se ejecutó realmente.
- Dictado de voz local: un botón de micrófono graba, transcribe localmente mediante el motor
  whisper de QVAC (`WHISPER_TINY_Q8_0`, multilingüe), y coloca la transcripción en el campo de
  texto existente para revisión — nunca se envía automáticamente. Ver la Capacidad 2 de
  [docs/MODEL_STRATEGY.md](docs/MODEL_STRATEGY.md).
- Un punto de extensión para futura evidencia fotográfica — una interfaz tipada preparada, no
  implementada, y no se presenta como tal.
- La interfaz de la aplicación está en español; este documento y el resto de `docs/` están en
  inglés.

## Arquitectura

Las dependencias apuntan hacia adentro: el renderer de React habla con una API de preload tipada
sobre IPC validado, que llama a los casos de uso de la aplicación, los cuales dependen únicamente
de conceptos de dominio. QVAC y SQLite son adaptadores de infraestructura detrás de puertos — solo
`src/infrastructure/qvac/**` puede importar `@qvac/sdk`, y cada resultado del modelo está
restringido por un esquema JSON y se revalida con Zod antes de que la aplicación confíe en él. La
detección de duplicados es una heurística transparente, versionada y puntuada, no una caja negra
de embeddings, de modo que un revisor siempre puede ver por qué se marcó un candidato.

Diagrama completo de componentes, flujo de datos y responsabilidades de cada módulo:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Ciclo de vida y manejo de fallos específico de QVAC:
[docs/QVAC_ARCHITECTURE.md](docs/QVAC_ARCHITECTURE.md).

## Privacidad y funcionamiento offline

- El contenido de las observaciones nunca cruza la red — verificado estáticamente (un único punto
  de importación del SDK, ningún `fetch`/cliente HTTP en todo `src/`, sin fuentes o CDNs remotos, y
  una CSP que en producción solo permite `connect-src 'self'`).
- La única operación de red que existe es la descarga del modelo desde el registro de QVAC, en la
  primera inicialización de un modelo dado, antes de que exista ninguna observación. Puede evitarse
  por completo suministrando un archivo de modelo local mediante `CIB_QVAC_MODEL_PATH` (texto) o
  `CIB_QVAC_VOICE_MODEL_PATH` (voz).
- El audio grabado por el micrófono nunca se persiste: se escribe en un archivo temporal de un solo
  uso solo durante la llamada de transcripción y se elimina inmediatamente después, con éxito o con
  fallo.
- Sin analítica, telemetría, reporte de fallos ni configuración remota — en ningún lugar.
- Modelo de amenazas completo, qué se registra en logs y qué deliberadamente no, y detalles del
  hardening de Electron: [docs/PRIVACY_OFFLINE.md](docs/PRIVACY_OFFLINE.md).
- Aún no se ha ejecutado una prueba física en modo avión por parte de un humano; ver
  [docs/DEMO.md](docs/DEMO.md) para la lista de validación pendiente.

## Dataset sintético

Los datos semilla incluidos son el dataset oficial del desafío: los 20 registros de la hoja
`Dummy Installed Base`, como 13 visitas en 13 instalaciones, en 13 ciudades y 10 países, usando las
seis marcas ficticias de la propia lista de referencia del documento. Cada instalación, marca,
modelo y observación en él es sintético por construcción — el propio documento declara que existen
únicamente para pruebas de hackathon. Las filas se transcriben en una tabla estática tipada, por lo
que no hay analizador de hojas de cálculo ni dependencia adicional en tiempo de ejecución. Los casos
de prueba de extracción provienen del mismo corpus oficial más casos adversariales creados para
este proyecto — ver [Evaluación y resultados](#evaluación-y-resultados) más abajo.

## Requisitos

- Node.js `>=24.20.0` y npm `>=10.9.0`; este repositorio fue verificado con Node 24.20.0.
- Un entorno de escritorio compatible con Electron.
- Para inferencia real con QVAC en Windows, un runtime/driver compatible con Vulkan 1.4 según se
  describe en los [requisitos de sistema de QVAC](https://docs.qvac.tether.io/system-requirements/).

## Instalación y ejecución

Instala las dependencias una vez:

```powershell
npm install
```

Inicia con el mock determinista etiquetado — no requiere descarga de modelo, el flujo completo se
puede ejercitar de inmediato:

```powershell
npm run dev
```

## Ejecución con QVAC real

```powershell
$env:CIB_INFERENCE_MODE = 'qvac'
npm run dev
```

Esto inicializa solo cuando se solicita desde la interfaz, carga el modelo configurado en el worker
local de completado de llama.cpp, solicita salida estricta en formato JSON según esquema, y valida
el resultado nuevamente con Zod. No hay proveedor en la nube ni respaldo silencioso hacia el mock —
un fallo de carga o de inferencia se muestra como un error visible.

Configuración opcional:

```powershell
$env:CIB_QVAC_MODEL_PATH = 'C:\models\model.gguf'   # archivo GGUF local, evita la descarga del registro
$env:CIB_QVAC_MODEL_NAME = 'Locally managed model'  # solo metadatos para mostrar
$env:CIB_DATABASE_PATH   = 'C:\path\to\database.sqlite'
```

Un `CIB_INFERENCE_MODE` inválido falla explícitamente (solo `qvac` o `mock`). En una ejecución de
desarrollo sin empaquetar, el valor por defecto es `mock`; en un runtime empaquetado, el valor por
defecto es `qvac`.

### Modelo recomendado para la demo

`CIB_QVAC_MODEL` selecciona qué modelo del registro carga el adaptador de QVAC. Valores aceptados:

| Valor            | Modelo                 | Rol                                                                                                                            |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `600m` (default) | `QWEN3_600M_INST_Q4`   | Respaldo rápido; default sin cambios para `npm run dev`, pruebas y cualquier ejecución que deje la variable sin definir        |
| `4b`             | `QWEN3_4B_INST_Q4_K_M` | **Recomendado para la demo** — precisión de extracción notablemente mayor, a costa de una descarga más grande y mayor latencia |

```powershell
# Configuración recomendada para la demo (la primera ejecución descarga ≈2.5 GB; luego queda en caché)
$env:CIB_INFERENCE_MODE = 'qvac'
$env:CIB_QVAC_MODEL = '4b'
npm run dev
```

```powershell
# Respaldo rápido, si la máquina de demo no puede permitirse el tiempo de carga o la latencia del modelo 4B
$env:CIB_INFERENCE_MODE = 'qvac'
$env:CIB_QVAC_MODEL = '600m'
npm run dev
```

Un valor inválido falla explícitamente, igual que `CIB_INFERENCE_MODE`. `CIB_QVAC_MODEL_PATH`,
cuando está definido, sigue teniendo prioridad sobre `CIB_QVAC_MODEL`. Ambos modelos se ejecutan
únicamente mediante `@qvac/sdk` — no existe respaldo en la nube para ninguno de los dos. Ver
[docs/MODEL_STRATEGY.md](docs/MODEL_STRATEGY.md) para la comparación completa y la decisión
registrada de mantener el default global en `600m` mientras la demo usa `4b` explícitamente, y
[docs/DECISIONS.md](docs/DECISIONS.md) decisión 18 para conocer el porqué.

### Aprovisionar un modelo en otra máquina

1. Después de que QVAC haya descargado un modelo una vez, toma el archivo correspondiente de
   `%USERPROFILE%\.qvac\models\` en la máquina de origen (por ejemplo `*_Qwen3-0.6B-Q4_0.gguf` para
   el modelo 600M, o el correspondiente `Qwen3-4B-Q4_K_M.gguf` para el modelo 4B).
2. Cópialo a la máquina destino, por ejemplo `C:\models\model.gguf`.
3. En el destino, define `$env:CIB_QVAC_MODEL_PATH = 'C:\models\model.gguf'` antes de iniciar en
   modo QVAC. Esto evita por completo la descarga desde el registro; la inferencia sigue siendo en
   el dispositivo.

Este procedimiento está documentado pero aún no ha sido ejercitado en una segunda máquina por un
humano — ver [docs/DEMO.md](docs/DEMO.md) para la lista de validación pendiente.

## Evaluación y resultados

```powershell
npm run typecheck       # validación estricta de TypeScript
npm run lint            # ESLint
npm test                # pruebas de dominio, aplicación, mock y persistencia — deterministas, sin necesidad de modelo
npm run format:check    # Prettier
npm run build           # typecheck más los bundles de Electron/Vite
npm run app:smoke       # construye y arranca la app empaquetada de extremo a extremo
npm run sqlite:smoke    # smoke real de transacciones con node:sqlite
npm run seed            # siembra local idempotente del dataset sintético oficial
npm run qvac:smoke      # smoke real de SDK/modelo/inferencia/esquema contra QVAC; nunca usa el mock
npm run qvac:voice-smoke # smoke real de whisper del SDK: carga de modelo, transcripción, descarga; nunca usa el mock
npm run corpus:eval     # puntúa el modelo real de QVAC contra el corpus de prueba de extracción
```

`npm test` se ejecuta enteramente contra el mock determinista y no necesita modelo ni hardware
específico. El smoke de QVAC debe imprimir cuatro verificaciones de ciclo de vida — runtime
inicializado, modelo cargado, inferencia local completada, salida estructurada validada — más la
confirmación de que se usó la ruta directa del SDK; un fallo al descargar o cargar el modelo se
reporta como un fallo, no como un cambio de motor. `npm run qvac:voice-smoke` prueba lo mismo para
voz contra un archivo WAV sintetizado (sin habla real) — demuestra que el pipeline corre en
hardware real, no que la transcripción sea precisa; ver la Capacidad 2 de
[docs/MODEL_STRATEGY.md](docs/MODEL_STRATEGY.md) para la pregunta abierta sobre la tasa de error de
palabras.

`npm run corpus:eval` puntúa el modelo real (cuál se selecciona de la misma forma que arriba, vía
`CIB_QVAC_MODEL`) contra un corpus de 30 casos de extracción, tomado del material oficial del
desafío más casos adversariales creados para este proyecto — ocho de los treinta son pruebas
dedicadas anti-fabricación que verifican que un valor esté correctamente **ausente**, no solo
correctamente encontrado. Metodología completa, qué cubre cada nivel de prueba, y cómo leer la
salida JSON de una ejecución: [docs/TESTING.md](docs/TESTING.md).

### Resultados medidos (resumen)

Los números a continuación provienen de una única ejecución de 30 casos por modelo, registrada en
[docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md),
[docs/MODEL_STRATEGY.md](docs/MODEL_STRATEGY.md) y los reportes JSON subyacentes en
[docs/qvac-eval-runs/](docs/qvac-eval-runs/). Describen la precisión de extracción contra este
corpus sintético específico, bajo una sola ejecución de muestreo cada uno — **no** es una cifra de
precisión clínica ni un benchmark de lenguaje de propósito general, y no está garantizado que se
reproduzca exactamente en una nueva ejecución, dado el muestreo no determinista de QVAC.

| Modelo                 |  Precisión general por campo |           Español |   Adversarial | Valores fabricados | Casos con aprobación total |
| ---------------------- | ---------------------------: | ----------------: | ------------: | -----------------: | -------------------------: |
| `QWEN3_600M_INST_Q4`   | 43.8–49.8% (según ejecución) |            37–39% |          ~52% |              46–53 |                   0–1 / 30 |
| `QWEN3_4B_INST_Q4_K_M` |          **82.6%** (238/288) | **76.7%** (56/73) | 82.4% (61/74) |                 11 |                     7 / 30 |

Ninguno de los dos modelos cumple con el estándar de calidad declarado por el proyecto (que todos
los casos de extracción documentados en [docs/TESTING.md](docs/TESTING.md) pasen), y aún no se ha
observado `certainty: 'Uncertain'` en ninguno de los modelos reales sobre este corpus, ni siquiera
con entradas explícitamente ambiguas — un hallazgo abierto y registrado (`E-11`), no algo que se
oculte aquí. El resultado del 4B es una mejora material y aprobada por humanos, usada para la demo;
no es una afirmación de que la extracción esté resuelta.

## Limitaciones conocidas

- La captura de voz/STT y la ingesta de fotos son solo puntos de extensión tipados — no
  implementados en el caso de fotos (la voz sí está implementada, ver Capacidades principales).
- Ninguno de los dos modelos cumple aún el propio estándar de calidad de extracción del proyecto
  (ver arriba); trata la demo como una vista previa de capacidad, no como una afirmación de
  precisión terminada.
- No se define ninguna política de antigüedad/vigencia — los valores de antigüedad del Dashboard se
  dejan deliberadamente sin clasificar en lugar de adivinarlos.
- El mock determinista reconoce la gramática de demostración suministrada, no lenguaje arbitrario;
  existe para iterar rápido y nunca se presenta como QVAC.
- La base de datos SQLite local no está cifrada en reposo (depende del aislamiento de cuenta del
  sistema operativo y del cifrado de disco completo) — una brecha aceptada y documentada para este
  prototipo, ver [docs/DECISIONS.md](docs/DECISIONS.md) decisión 14.
- Analítica en lenguaje natural, autenticación, sincronización multiusuario, fusión automática de
  entidades, empaquetado de modelos e instaladores de producción quedan fuera de este corte
  vertical.
- Una prueba física en modo avión y una prueba de aprovisionamiento de modelo en una segunda
  máquina están documentadas pero aún no ejecutadas por un humano — ver
  [docs/DEMO.md](docs/DEMO.md).

## Estructura del repositorio

```
src/
  domain/          reglas de negocio puras — normalización, manejo de antigüedad, confianza, duplicados
  application/     casos de uso, puertos, contratos, el prompt de extracción — sin imports de framework
  infrastructure/  adaptador de QVAC, mock de desarrollo, repositorio SQLite, datos semilla
    qvac/          el único directorio autorizado a importar @qvac/sdk
  main/            proceso principal de Electron, composition root, handlers de IPC
  preload/         API tipada y acotada expuesta al renderer
  renderer/        interfaz React (en español)
  shared/          tipos de contrato IPC compartidos entre procesos
tests/             refleja src/ por capa; fixtures del corpus de extracción en tests/fixtures/corpus/
scripts/           seed, smoke tests, evaluación de corpus
docs/              arquitectura, estrategia de modelos, privacidad, pruebas, decisiones (ver tabla abajo)
```

## Demo

Ver [docs/DEMO.md](docs/DEMO.md) para el guion de recorrido dirigido a jueces (en español, acorde
con la interfaz de la aplicación), los puntos clave a mencionar, y la lista pendiente de validación
offline por un humano.

Como inicio rápido, la pantalla vacía de **Capturar** tiene una observación de ejemplo de un clic.
Un guion de regresión manual más completo para la detección de duplicados (corroboración vs.
conflicto) vive en [docs/TESTING.md](docs/TESTING.md), ya que es un guion de QA y no material de
demo.

## Semántica de los datos

- Las sesiones y la evidencia guardadas son de solo anexado (append-only). Las correcciones se
  aplican al borrador mutable antes de guardar.
- Las antigüedades aproximadas se mantienen como exactas, estimadas, en rango, cualitativas o
  desconocidas. Las estimaciones numéricas de instalación se derivan solo cuando la antigüedad
  reportada lo permite, y se marcan como `Derived`.
- La confianza es una estrategia explicable `confidence-v1` con IDs de evidencia, no un número de
  confianza sin explicación.
- La detección de duplicados genera candidatos puntuados `PossibleDuplicate`,
  `PossibleCorroboration`, o `PossibleConflict`. Las resoluciones humanas son `NotDuplicate`,
  `SameEquipment`, o `CorroboratingEvidence`; ninguna fusiona registros automáticamente.
- Customer 360 usa actualmente `latest-per-signature-v1`; sus IDs de observación contribuyentes
  mantienen la trazabilidad de proyección a evidencia.

## Documentación

| Documento                                          | Contenido                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Demo](docs/DEMO.md)                               | Guion de recorrido para jueces y lista de validación offline                                                     |
| [Architecture](docs/ARCHITECTURE.md)               | Componentes, capas, flujo de datos, responsabilidades de módulos                                                 |
| [QVAC architecture](docs/QVAC_ARCHITECTURE.md)     | Dónde vive QVAC, ciclo de vida del modelo, manejo de fallos                                                      |
| [QVAC compliance](docs/QVAC_COMPLIANCE.md)         | SDK, plugins, modelo, salida estructurada, postura de red                                                        |
| [Data schema](docs/DATA_SCHEMA.md)                 | Qué es una observación, y cómo se preserva la incertidumbre                                                      |
| [Model strategy](docs/MODEL_STRATEGY.md)           | Qué modelo para cada capacidad, y por qué no uno más grande                                                      |
| [Privacy and offline](docs/PRIVACY_OFFLINE.md)     | Modelo de amenazas, qué puede tocar la red                                                                       |
| [Performance budgets](docs/PERFORMANCE_BUDGETS.md) | Qué medir y cómo, más las ejecuciones de evaluación registradas                                                  |
| [Testing](docs/TESTING.md)                         | Estrategia de pruebas para IA local, incluyendo casos de extracción y el guion manual de detección de duplicados |
| [Technical decisions](docs/DECISIONS.md)           | Registro de ADR                                                                                                  |
