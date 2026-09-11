# Privacidad y comportamiento offline

## Por qué existe este documento

Los colegas de campo registran lo que vieron dentro de hospitales y clínicas. Ese contenido puede nombrar una
instalación, describir su equipo, e identificar quién lo reportó. Puede registrarse donde la
conectividad es escasa o nula. La arquitectura es local-first y privacy-first porque ambas
restricciones son reales, no aspiracionales.

## La regla

**La captura y la extracción deben funcionar en modo avión una vez que el modelo requerido está en el dispositivo.**

Todo lo que sigue apoya esa regla o explica la única excepción estrecha a ella.

## Dos tipos de tráfico, nunca confundidos

### TRÁFICO DE INFERENCIA — debe ser cero

Ningún contenido de observación cruza jamás la red. No hay modelo en la nube, ni API de inferencia, ni
prompt remoto, ni validación remota.

Propiedades verificables hoy:

- La única dependencia de IA es `@qvac/sdk`, que ejecuta workers locales de llama.cpp y whisper.cpp.
- `@qvac/sdk` se importa solo bajo `src/infrastructure/qvac/`: `qvac-observation-extraction.ts`
  (texto) y `qvac-speech-to-text.ts` (voz). Ningún otro archivo en `src/` lo importa.
- No existe ningún cliente HTTP ni llamada `fetch` en ningún lugar de `src/`.
- La CSP del renderer de producción solo permite `connect-src 'self'`; no lleva ningún WebSocket de
  desarrollo ni endpoint de red externo. Solo el entorno de desarrollo permite `ws://localhost:*` para el
  socket de desarrollo de Vite.
- El renderer no referencia ninguna fuente remota, CDN, ni URL externa.
- `qvac.config.json` no configura ningún endpoint de inferencia remoto, porque 0.19.0 no tiene ninguno.

### TRÁFICO OPCIONAL DE SINCRONIZACIÓN Y DESCARGA DE MODELO — estrecho y explícito

Solo existe un tipo de operación de red: en la primera inicialización de un modelo dado, el registro de
modelos de QVAC puede descargar el artefacto de ese modelo a su caché local. Ahora hay dos modelos
que pueden disparar esto de forma independiente, una vez cada uno, la primera vez que se usan.

| Propiedad                         | Valor                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Qué se envía                      | Una solicitud de modelo. **Nunca datos de observación, para ninguno de los dos modelos.**                               |
| Cuándo                            | Solo en la primera inicialización de un modelo dado, cuando aún no está en caché                                        |
| ¿Es requerido para la inferencia? | No. Una vez en caché, la inferencia es completamente local                                                              |
| Cómo evitarlo por completo        | Establecer `CIB_QVAC_MODEL_PATH` (texto) o `CIB_QVAC_VOICE_MODEL_PATH` (voz) a un archivo aprovisionado localmente      |
| Tamaño                            | ≈365 MiB (modelo de texto por defecto) + ≈42 MiB (`WHISPER_TINY_Q8_0`, voz). Ver [MODEL_STRATEGY.md](MODEL_STRATEGY.md) |

Para un despliegue genuinamente desconectado, aprovisione el archivo de modelo fuera de banda y establezca
`CIB_QVAC_MODEL_PATH`. Esa vía no realiza ningún acceso a la red en absoluto.

**La sincronización no está implementada.** No hay servidor, ni cuenta, ni subida. Si alguna vez se agrega
sincronización, será una función separada, opcional (opt-in) y claramente etiquetada, y nunca debe estar en
la ruta crítica — ver la sección de sincronización más abajo.

## Datos que nunca deben salir del dispositivo

| Dato                                       | Dónde vive                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Texto crudo de observación                 | `evidence_items.raw_text`, SQLite local                                                                                                                                                                                                                                                                                                                                         |
| Transcripciones de voz                     | No es una categoría distinta: una transcripción se coloca en el campo de texto ordinario para revisión y, una vez enviada, se almacena exactamente igual que el "Texto crudo de observación" de arriba — no existe ninguna tabla de evidencia etiquetada como `Voice`                                                                                                           |
| Artefactos de audio                        | **Deliberadamente nunca persistidos.** El audio grabado se escribe en un archivo temporal del sistema operativo de un solo uso solo durante la duración de una llamada a `transcribe()`, y siempre se elimina inmediatamente después, con éxito o con fallo (`src/main/voice-transcription.ts`). No existe ningún `local_artifact_uri` ni ninguna configuración que cambie esto |
| Fotos (**PLANIFICADO**)                    | igual                                                                                                                                                                                                                                                                                                                                                                           |
| Nombres de instalaciones, ciudades, países | `customers`, `observation_sessions`                                                                                                                                                                                                                                                                                                                                             |
| Identidad del reportero                    | `observation_sessions.observer_id`, `observer_display_name`                                                                                                                                                                                                                                                                                                                     |
| Prompts enviados al modelo                 | construidos en memoria, nunca persistidos ni registrados en logs                                                                                                                                                                                                                                                                                                                |
| Tokens generados                           | drenados y descartados; solo se conserva el JSON final validado                                                                                                                                                                                                                                                                                                                 |

## Almacenamiento local

- SQLite mediante el `node:sqlite` incorporado de Node, modo WAL, claves foráneas activadas.
- La ubicación por defecto es el directorio `userData` por usuario de Electron. `CIB_DATABASE_PATH` la
  reemplaza. El script de semilla escribe `data/customer-installed-base.sqlite`, que está en el gitignore.
- **No cifrado en reposo — PLANIFICADO.** El prototipo depende del aislamiento de cuentas de usuario del sistema
  operativo y del cifrado de disco completo. El cifrado de la base de datos es una brecha real para un
  despliegue de producción y está registrado como una decisión abierta en [DECISIONS.md](DECISIONS.md).
- Las observaciones guardadas son de solo anexado (append-only). Hoy no hay ninguna vía de borrado masivo ni exportación.

## Registro en logs

- `qvac.config.json` establece `loggerLevel: "warn"` y `loggerConsoleOutput: false`.
- El adaptador de QVAC deliberadamente no registra en logs los eventos `contentDelta`. El código lo dice
  explícitamente en el bucle de drenado, porque ese es el único lugar donde una línea de depuración bien intencionada
  escribiría contenido de observación hospitalaria en un log.
- **Regla:** nunca registrar en logs texto crudo de observación, transcripciones, prompts, tokens generados, nombres
  de instalaciones, ni identidad del reportero. Registrar en su lugar transiciones de estado y clases de error.
- Electron y Node pueden escribir información de fallos al sistema operativo. Eso está fuera del control de la
  aplicación y se menciona aquí para que no se confunda con una garantía.

## Analítica, telemetría, reporte de fallos

**Ninguno. Los tres están prohibidos.**

Sin SDK de analítica, sin endpoint de telemetría, sin reporte de fallos, sin feature flags remotos, sin
configuración remota. Agregar cualquiera de ellos requiere una decisión de producto explícita registrada en
DECISIONS.md, y aun así debe excluir por completo el contenido de las observaciones.

## Comportamiento sin red

| Operación                                                  | Funciona offline                        |
| ---------------------------------------------------------- | --------------------------------------- |
| Arranque de la aplicación                                  | sí                                      |
| Lectura y escritura de la base de datos                    | sí                                      |
| Captura de texto                                           | sí                                      |
| Extracción, con el modelo ya local                         | sí                                      |
| Dictado de voz, con el modelo ya local                     | sí                                      |
| Preguntas de seguimiento, correcciones, revisión, guardado | sí, toda lógica de dominio determinista |
| Customer 360 y Dashboard                                   | sí                                      |
| Semilla                                                    | sí                                      |
| `npm test`                                                 | sí                                      |
| `npm run qvac:smoke`, con el modelo ya local               | sí                                      |
| `npm run qvac:voice-smoke`, con el modelo ya local         | sí                                      |
| Primera descarga de cualquiera de los dos modelos          | **no**, esta es la única excepción      |

No hay ningún modo degradado ni respaldo silencioso. Si QVAC no puede iniciar o el modelo no puede
cargarse, el usuario ve un error con el estado real. El badge del motor siempre nombra el motor que
realmente se ejecutó.

## Hardening de Electron

Verificado en `src/main/index.ts`:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `setWindowOpenHandler` deniega todas las ventanas nuevas
- El preload expone una API tipada acotada solo sobre canales de IPC nombrados
- Cada payload de IPC se parsea con Zod antes de que se ejecute un caso de uso

El renderer no puede alcanzar el sistema de archivos, el SDK, ni canales arbitrarios.

## Sincronización futura — PROPUESTO, no implementado

Si alguna vez se requiere consolidar observaciones entre colegas, aplican estas restricciones:

1. Opcional (opt-in) por usuario, nunca por defecto.
2. La captura y extracción locales deben seguir funcionando con la sincronización no disponible. La sincronización nunca está en
   la ruta crítica.
3. Lo que se sincronice debe ser enumerable y revisable antes de enviarse.
4. Transporte cifrado; el cifrado en reposo del lado receptor decidido antes de cualquier código.
5. El audio crudo y las fotos son los payloads de mayor riesgo y deberían ser lo último que se considere,
   si es que alguna vez se hace.
6. Registrado en DECISIONS.md antes de implementarse, no después.

## Modelo de amenazas, brevemente

| Amenaza                                                        | Mitigación hoy                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Contenido de observación llegando a un proveedor de IA externo | No existe ningún proveedor en la nube en el grafo de dependencias. Solo un archivo importa el SDK                               |
| Fuga de contenido a través de logs                             | Salida de consola deshabilitada, registro de tokens deliberadamente omitido, regla documentada                                  |
| Fuga de contenido a través de analítica                        | No existe ninguna dependencia de analítica                                                                                      |
| Compromiso del renderer alcanzando el sistema de archivos      | Aislamiento de contexto, sandbox, sin integración de node, IPC validado                                                         |
| Robo del dispositivo                                           | **Brecha.** Depende de la cuenta del sistema operativo y del cifrado de disco. Ver la sección de almacenamiento                 |
| Dependencia maliciosa exfiltrando datos                        | **Parcial.** El número de dependencias es pequeño y revisado. No existe ninguna puerta de auditoría de lockfile — **PROPUESTO** |
| La descarga del modelo revela que la app está en uso           | Aceptado, y evitable con `CIB_QVAC_MODEL_PATH`                                                                                  |

## Cómo verificar

Use la skill `offline-validation`. Tiene los comandos de análisis estático, el procedimiento de
modo avión, y los criterios de aprobación.

La lista de validación humana previa al demo —desconexión física de red, flujo completo de captura a
guardado, verificaciones de Customer 360 y Dashboard— vive en
[docs/DEMO.md](DEMO.md#checklist-de-validación-offline--validación-humana-requerida) y está marcada
**VALIDACIÓN HUMANA REQUERIDA** hasta que una persona la haya ejecutado y marcado. Ninguna sesión de agente ha
realizado una ejecución física en modo avión.
