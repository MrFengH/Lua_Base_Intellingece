# Esquema de datos

El modelo conceptual de una observación de campo de equipo médico instalado, y cómo se mapea a
los tipos de TypeScript y las tablas de SQLite que existen hoy.

## El principio rector

Una observación registra **lo que una persona reportó durante una visita**, no la verdad actual
sobre el equipo de un hospital. El esquema por lo tanto separa cuatro cosas que un diseño ingenuo
colapsaría en un solo valor:

| Pregunta                                                                  | Dónde vive la respuesta                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| ¿Qué se dijo?                                                             | `EvidenceItem.rawText`, conservado textualmente      |
| ¿Qué se observó directamente vs. qué se infirió?                          | `FieldProvenance.origin`                             |
| ¿El valor es conocido, desconocido, o simplemente no se preguntó todavía? | `FieldProvenance.knowledgeState`                     |
| ¿Qué tan seguro estaba el hablante?                                       | `FieldProvenance.certainty` y `ConfidenceAssessment` |

**`null` o `Unknown` siempre gana a una suposición plausible.** Un campo que no puede representar
"no se sabe" es un defecto de esquema.

## Estado de conocimiento, origen, certeza

Estos son tres ejes independientes, definidos en `src/domain/model/enums.ts`.

**`KnowledgeState`** — ¿existe siquiera un valor?

- `Missing` — nunca se mencionó, nunca se preguntó. Justifica una pregunta de seguimiento.
- `Known` — existe un valor.
- `DeclaredUnknown` — la persona dijo que no lo sabe. Esto es información. El sistema nunca
  debe volver a preguntar el mismo campo, y nunca debe rellenarlo más tarde por inferencia.

**`FieldOrigin`** — ¿de dónde vino el valor?

- `Observed` — visto directamente.
- `Reported` — declarado por la persona.
- `Derived` — calculado por una regla, por ejemplo un año de instalación a partir de una antigüedad.
- `Unknown`.

**`FactCertainty`** — ¿qué tan firme fue la declaración?

- `Explicit` — "el fabricante es NovaMed".
- `Uncertain` — "creo que el fabricante era NovaMed".
- `Unknown`.

En la extracción en vivo, `certainty` también puede ser `null` cuando el extractor no suministró ninguna
certeza. `null` significa "no suministrado"; `Unknown` significa que el extractor clasificó explícitamente la
certeza como desconocida. Ninguno de los dos se asciende a `Explicit`.

La combinación es lo que hace honesto al registro. "Creo que el fabricante era NovaMed" es
`Known` + `Reported` + `Uncertain`, no `Known` + `Observed` + `Explicit`.

Durante un seguimiento pendiente, las respuestas de desconocido declarado se reconocen de forma determinista en lugar de
enviarse al motor de extracción. Las formas en español soportadas incluyen `no sé`, `no se`, `no lo sé`,
`no lo se`, `ni idea`, `no estoy seguro`, `no estoy segura`, `no me fijé`, `no sabría decir` y
`ni idea la verdad`; las formas en inglés existentes incluyen `I don't know`, `I do not know`, `unknown`
y `not sure`. Un `no` aislado se reconoce solo mientras se responde a un seguimiento del tipo "¿Conoce…?".
El comparador más largo está anclado al inicio de la respuesta, mientras que la forma corta `no` debe ser toda
la respuesta, así que una corrección como `no es NovaMed, es Orion Imaging` sigue siendo una respuesta conocida y
procede por extracción.

## La antigüedad es una unión, no un número

`ApproximateAge` en `src/domain/model/age.ts`:

```ts
| { type: 'exact'; years: number }
| { type: 'estimate'; minYears: number; maxYears: number }
| { type: 'range'; minYears: number; maxYears: number }
| { type: 'qualitative'; label: string }
| { type: 'unknown' }
```

"Unos ocho años" es `estimate`, nunca `exact`. "Bastante viejo" es `qualitative` y nunca debe
adquirir un número. Esta es la salvaguarda anti-fabricación más importante en el esquema,
porque la antigüedad es el campo que un modelo está más tentado a inventar.

`InstallationEstimate` se deriva de la antigüedad y la fecha de observación. Lleva su propio
`origin`, se marca `Estimated` en lugar de `Exact` cuando la antigüedad era aproximada, y permanece
`unknown` cuando la antigüedad era cualitativa o desconocida.

## Entidades

### Customer

La instalación. `src/domain/model/observation.ts`, tabla `customers`.

| Campo                    | Requerido          | Notas                          |
| ------------------------ | ------------------ | ------------------------------ |
| `id`                     | sí                 |                                |
| `name`                   | sí                 | tal como se reportó            |
| `normalizedName`         | sí                 | derivado, usado para identidad |
| `city`, `country`        | opcional, anulable |                                |
| `createdAt`, `updatedAt` | sí                 |                                |

La identidad es el índice único sobre `(normalized_name, city, country)`. Dos grafías del mismo
hospital en ciudades distintas permanecen separadas en lugar de fusionarse por una suposición.

### ObservationSession

Una visita de un observador. Tabla `observation_sessions`. **De solo anexado (append-only) una vez guardada.**

| Campo                 | Requerido          | Notas                                                        |
| --------------------- | ------------------ | ------------------------------------------------------------ |
| `id`                  | sí                 | el `observationId` que rastrean la interfaz y la proyección  |
| `customerId`          | sí                 |                                                              |
| `observer`            | sí                 | `{ id, displayName }`, el reportero                          |
| `visitId`             | sí                 | agrupa la evidencia de una visita                            |
| `observedAt`          | sí                 | cuándo ocurrió la observación                                |
| `createdAt`           | sí                 | cuándo se registró                                           |
| `lastVerifiedAt`      | opcional, anulable |                                                              |
| `rawInput`            | anulable           | la captura principal, conservada para auditoría              |
| `reportedFacility`    | sí                 | la instalación tal como se reportó, antes del emparejamiento |
| `evidence`            | sí                 | la lista de `EvidenceItem`                                   |
| `supersedesSessionId` | opcional, anulable | una visita posterior que corrige una anterior                |

La tabla también lleva `seed_key`, que no forma parte del tipo de dominio. Nombra la semilla que
escribió la fila y es `NULL` para todo lo que un usuario capturó, de modo que una semilla reemplazada pueda
retirarse sin una heurística que adivine qué filas eran fixtures. Nada excepto el mecanismo de semilla lo lee.

`reportedFacility` se mantiene deliberadamente separado del `Customer` resuelto. Lo que la persona
dijo y con qué lo emparejó el sistema son dos hechos diferentes.

### EvidenceItem

El material crudo. Tabla `evidence_items`.

| Campo              | Requerido          | Notas                                                            |
| ------------------ | ------------------ | ---------------------------------------------------------------- |
| `id`               | sí                 | referenciado por la procedencia de cada campo                    |
| `sessionId`        | sí                 |                                                                  |
| `source`           | sí                 | `Text`, `Voice`, o `Photo`                                       |
| `capturedAt`       | sí                 |                                                                  |
| `rawText`          | anulable           | el texto textual o la transcripción                              |
| `localArtifactUri` | opcional, anulable | un archivo local, nunca subido — **PLANIFICADO** para voz y foto |
| `metadata`         | opcional           | JSON acotado                                                     |

`Voice` y `Photo` están declarados en el enum y en la restricción de la tabla, pero ningún adaptador los
produce todavía — **PLANIFICADO**. Una transcripción de voz pertenece aquí como `rawText` con `source: 'Voice'`.

Guardar requiere una confirmación explícita además del estado de revisión. Cuando no queda ningún seguimiento,
el agente lee el borrador de vuelta como un resumen conversacional, construido de forma determinista a partir del
borrador por `ReviewSummaryService`, y pregunta si es correcto. La aceptación del observador se registra como
un ítem de evidencia con el prefijo `confirmation:`. Corregir un campo después retira la aceptación
y el resumen se vuelve a leer, porque el contenido que el observador aceptó ha cambiado.

Una corrección manual aplicada en el paso de revisión es en sí misma evidencia. Cada corrección aplicada se
registra como un ítem de evidencia cuyo id lleva el prefijo `correction:`, de modo que la procedencia de un campo
corregido apunte a algo que existe en lugar de a una referencia colgante.

Una corrección es una actualización parcial. Solo se envían los campos que el observador realmente cambió, y un
campo que no tocó nunca se limpia, se vuelve a derivar, ni se reescribe — una antigüedad cualitativa sobrevive
intacta a una corrección del nombre de la instalación.

Los IDs de evidencia se acumulan, nunca se reemplazan. Cuando el valor de un campo cambia —mediante un mensaje
posterior, una respuesta de seguimiento, o una corrección de revisión— el nuevo ID de evidencia se agrega a los IDs
que ya tenía ese campo. El mensaje que hizo la primera afirmación sigue siendo alcanzable desde el campo que
ahora tiene la segunda.

### Contradicciones dentro de una captura

Dos afirmaciones incompatibles sobre el mismo campo, ambas cosas que el observador dijo dentro de la misma
sesión, son una contradicción. Es algo distinto de `DuplicateCandidate`, que compara observaciones
entre sesiones guardadas, y las dos cosas nunca interactúan.

Cómo se trata un segundo valor depende del estado en que estaba el campo y de la propia redacción del
observador, nunca de los valores en sí:

| Estado anterior               | Valor posterior | Se trata como   | Resultado                                                       |
| ----------------------------- | --------------- | --------------- | --------------------------------------------------------------- |
| `Missing`                     | un valor        | enriquecimiento | se toma el valor                                                |
| `DeclaredUnknown`             | un valor        | enriquecimiento | se toma el valor, el ID de evidencia anterior permanece         |
| `Known`, mismo valor          | mismo valor     | corroboración   | sin cambios, se agrega el ID de evidencia                       |
| `Known`, corrección explícita | diferente       | autocorrección  | se toma el valor posterior con la certeza que declara           |
| `Known`, cualquier otra cosa  | diferente       | contradicción   | el valor posterior queda activo pero `Uncertain`, y se pregunta |

Una autocorrección se reconoce solo por redacción inequívoca como "en realidad", "perdón",
"me equivoqué", "actually" o "I meant", y una redacción matizada como "quizá" o "creo que" siempre
gana sobre ella. Nada infiere cuál valor es correcto a partir de los valores.

Una contradicción sin resolver produce un seguimiento `Required` que nombra ambas afirmaciones y pregunta cuál
conservar. Hasta que se responde, la captura permanece en `NEEDS_FOLLOW_UP`, la revisión no se puede
alcanzar, y cualquier confirmación ya dada se retira — una contradicción nunca puede quedar enterrada bajo un
"sí, es correcto". Responderla con cualquiera de las dos afirmaciones restaura la certeza `Explicit`; declinar
con una respuesta de desconocido declarado deja el campo `DeclaredUnknown`.

Nada de una contradicción se persiste como su propio registro, y no se necesitó ninguna migración. El
desacuerdo vive en el borrador mientras está abierto; lo que sobrevive en la base de datos son los
`evidenceIds` acumulados del campo y las filas de evidencia de solo anexado, que juntas responden qué se dijo
primero, qué se dijo después, y qué valor se aceptó.

### EquipmentObservation

Un grupo de equipos reportado en una sesión. Tabla `equipment_observations`.

| Campo                  | Requerido          | Tipo         | Notas                                                                           |
| ---------------------- | ------------------ | ------------ | ------------------------------------------------------------------------------- |
| `id`                   | sí                 |              |                                                                                 |
| `sessionId`            | sí                 |              |                                                                                 |
| `groupOrder`           | sí                 |              | preserva el orden en que la persona describió las cosas                         |
| `modality`             | sí                 | inferido     | el vocabulario cerrado de abajo                                                 |
| `rawModality`          | opcional, anulable | observado    | las palabras realmente usadas, conservadas cuando la normalización no es segura |
| `quantity`             | anulable           | inferido     | entero positivo o nulo                                                          |
| `manufacturer`         | anulable           | inferido     |                                                                                 |
| `model`                | anulable           | inferido     |                                                                                 |
| `approximateAge`       | sí                 | inferido     | la unión de arriba                                                              |
| `installationEstimate` | sí                 | **derivado** | a partir de la antigüedad más `observedAt`                                      |
| `confidence`           | sí                 | derivado     | `ConfidenceAssessment`                                                          |
| `status`               | sí                 | derivado     | `Confirmed`, `Reported`, `Estimated`, `Unknown`, ver abajo                      |
| `notes`                | anulable           | observado    |                                                                                 |
| `evidenceIds`          | sí                 |              | qué evidencia respalda este grupo                                               |
| `fieldProvenance`      | sí                 |              | estado de conocimiento, origen, certeza e IDs de evidencia por campo            |

#### Estado de la observación

El estado responde **cómo llegó el observador a saber esto**, y nada más. No es un nivel de
confianza ni es la certeza de un campo. Los tres pueden estar en desacuerdo, y eso es correcto: "vi un MR
que parecía tener unos siete años" es `Confirmed` con una antigüedad `Uncertain`, y "me dijeron que tiene
exactamente siete años" es `Reported` con una antigüedad `Explicit`.

| Valor       | Significado                                                           |
| ----------- | --------------------------------------------------------------------- |
| `Confirmed` | El observador afirma haber visto el equipo él mismo                   |
| `Reported`  | El observador está transmitiendo lo que otra persona o fuente le dijo |
| `Estimated` | El observador presenta el relato como su propia estimación            |
| `Unknown`   | No se pudo establecer el origen, incluida una pregunta rechazada      |

Lo decide `deriveObservationStatus` en `src/domain/rules/observation-basis.ts` a partir del
`observationBasis` de la sesión, que se establece ya sea por una declaración inequívoca en las propias
palabras del observador o por su respuesta a la pregunta de seguimiento `Preferred` "¿Observó este equipo
directamente, se lo reportó otra persona, o es una estimación?". Cuando el origen nunca se estableció, y solo
entonces, el estado recae en la regla anterior derivada de la antigüedad, que es en lo que se apoyaba cada
registro escrito antes de que esto existiera. Declinar la pregunta almacena `Unknown`; nunca produce `Confirmed`.

Los 20 registros oficiales son una transcripción, no una captura. Llevan la propia columna `Status` del
libro de trabajo, 13 `Reported` y 7 `Estimated`, y esta regla no los toca.

#### Vocabulario de modalidad

Un conjunto cerrado, definido una vez en `src/domain/model/enums.ts` e incrustado en el esquema JSON que el
modelo debe satisfacer. Los seis valores coinciden con la lista oficial de modalidad de `Dummy Reference Lists`;
`Unknown` es la adición de este proyecto y existe para que la incertidumbre permanezca incierta.

| Valor                  | Sinónimos reconocidos, sin distinguir mayúsculas ni acentos                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `MR`                   | `mr`, `mri`, `magnetic resonance`, `resonancia`, `resonador`, `resonadores`              |
| `CT`                   | `ct`, `cat scan`, `computed tomography`, `tomografia`, `tomografo`, `tomografos`         |
| `Ultrasound`           | `ultrasound`, `ultrasonido`, `ultrasonidos`                                              |
| `X-Ray`                | `x-ray`, `xray`, `rayos x`                                                               |
| `Patient Monitoring`   | `patient monitoring`, `patient monitor`, `monitor de paciente`, `monitoreo de pacientes` |
| `Image Guided Therapy` | `image guided therapy`, `image-guided therapy`, `igt`, `terapia guiada por imagen`       |
| `Unknown`              | `unknown`, `desconocido`, y **cualquier cosa no reconocida**                             |

`normalizeModality` nunca adivina. Un simple `scanner` es ambiguo entre MR y CT, así que se
normaliza a `Unknown` y la redacción original se conserva en `rawModality`. El formulario de corrección
presenta la modalidad como un selector sobre este vocabulario, así que un valor escrito ya no puede descartarse
silenciosamente.

**El agrupamiento importa.** "Dos tienen unos nueve años y uno unos tres" son dos grupos, no un
grupo de tres con una antigüedad promediada. Promediar sería fabricar.

**El número de serie** no está en el esquema. Es teóricamente observable a partir de la etiqueta de un
dispositivo, pero nada en el flujo de captura actual lo recolecta, y agregar un campo sin usar invita al modelo
a rellenarlo. Agréguelo cuando una vía de captura realmente lo produzca — **PROPUESTO**, ver
[DECISIONS.md](DECISIONS.md).

### ConfidenceAssessment

No es un número simple. `src/domain/model/confidence.ts`.

| Campo             | Notas                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `level`           | `High`, `Medium`, `Low`, `Unknown`                                          |
| `score`           | de 0 a 1, o `null` cuando no se sabe nada                                   |
| `reasons`         | razones codificadas, por ejemplo `UNCERTAINTY_LANGUAGE`, `DERIVED_FACTS`    |
| `evidenceIds`     | en qué se basó la evaluación                                                |
| `strategyVersion` | `confidence-v1`, para que las evaluaciones almacenadas sigan interpretables |

Un puntaje sin explicación no es una salida aceptable. Los códigos de razón son lo que permite a un
revisor estar en desacuerdo con el número.

**La procedencia se muestra, no solo se almacena.** `InstalledBaseItem`, la proyección devuelta por
`getCustomer360`, lleva `rawModality` y `fieldProvenance` junto a `confidence` — no se persiste nada nuevo
y no cambia ningún contrato de IPC; el mapeo del repositorio hacia la vista simplemente se extendió para incluir
datos que ya existían por fila de equipo. La tarjeta de Customer 360 en
`App.tsx` renderiza el nivel de confianza con sus códigos de razón traducidos a etiquetas humanas, el
estado con una explicación fija de una línea sobre qué significa ese estado (nunca recalculada a partir del
registro), y una sección expandible de "Detalles del campo" que lista el estado de conocimiento de cada campo
(`Known` / `Declared unknown` / `Not mentioned`), su origen y su certeza (`Explicit`,
`Uncertain`, `Unknown`, o "Not supplied" para una certeza `null`). Un campo cuya evidencia incluye
un id con prefijo `correction:` se marca `Corrected`, leyendo el mismo rastro de evidencia que las correcciones
ya escriben en lugar de agregar un nuevo mecanismo de historial. `rawModality` se muestra como "Captured as"
solo cuando difiere de la `modality` normalizada; las filas de la semilla oficial, donde ambas son idénticas,
no muestran nada adicional. Un registro sin ninguna procedencia por campo —por ejemplo una fila histórica—
se degrada a una sección de detalles vacía en lugar de fallar.

### DuplicateCandidate

Tabla `duplicate_candidates`. Ver la sección de deduplicación de abajo.

## Resumen de clasificación de campos

| Clasificación                 | Campos                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requerido                     | `observationId` (id de sesión), `customerId`, `observer`, `visitId`, `observedAt`, `modality`, `approximateAge`, `confidence`, `fieldProvenance`, `evidenceIds` |
| Opcional / anulable           | `city`, `country`, `quantity`, `manufacturer`, `model`, `notes`, `rawModality`, `lastVerifiedAt`, `localArtifactUri`                                            |
| Inferido por el modelo        | `modality`, `quantity`, `manufacturer`, `model`, `approximateAge`, `notes`, `certainty`                                                                         |
| Derivado por reglas           | `normalizedName`, `installationEstimate`, `confidence`, `status`, puntajes de duplicados                                                                        |
| Explícitamente no cognoscible | cualquier campo con `knowledgeState: 'DeclaredUnknown'`                                                                                                         |
| Aún no modelado               | `serialNumber`, `locationWithinFacility`, `condition` — **PROPUESTO**                                                                                           |

`locationWithinFacility` y `condition` se consideraron y se dejaron fuera. Ninguno lo recolecta el
flujo de seguimiento actual, y un campo anulable sin usar es una invitación a alucinar. Ambos son
adiciones razonables una vez que el flujo de captura los pida.

## El contrato de extracción

`src/application/contracts/extraction.ts` define el esquema de Zod que el modelo debe satisfacer. Es
deliberadamente más estrecho que el modelo de dominio: el modelo produce observaciones, y el dominio
deriva todo lo demás.

El modelo devuelve: `customer { name, city, country }` y `equipment[] { modality, rawModality,
quantity, manufacturer, model, approximateAge, notes, certainty }`. `certainty` es anulable cuando el
extractor no suministra ninguna evaluación. **No** devuelve
puntajes de confianza, años de instalación, procedencia, ni juicios de duplicados. Esos se calculan
a partir de reglas que el equipo puede inspeccionar y versionar, no los afirma un modelo.

Esa separación es la segunda salvaguarda anti-fabricación. Un modelo al que se le pide `confidence: 0.9`
suministrará 0.9.

## Ejemplo resuelto

Entrada:

> "Vi dos resonadores NovaMed. Uno parece bastante nuevo y el otro probablemente tenga unos
> ocho años. También había un tomógrafo Orion Imaging, pero no pude ver el modelo."

Tres grupos, porque los dos equipos de MR tienen antigüedades diferentes:

| Grupo | modality | quantity | manufacturer    | model  | approximateAge                                     | certainty   |
| ----- | -------- | -------- | --------------- | ------ | -------------------------------------------------- | ----------- |
| 1     | `MR`     | 1        | `NovaMed`       | `null` | `{ type: 'qualitative', label: 'bastante nuevo' }` | `Uncertain` |
| 2     | `MR`     | 1        | `NovaMed`       | `null` | `{ type: 'estimate', minYears: 7, maxYears: 9 }`   | `Uncertain` |
| 3     | `CT`     | 1        | `Orion Imaging` | `null` | `{ type: 'unknown' }`                              | `Explicit`  |

Note lo que **no** ocurre: "bastante nuevo" no se convierte en 2 años; los modelos faltantes permanecen
`null` en lugar de adivinarse a partir del fabricante; "probablemente" hace que la antigüedad sea
`Uncertain` en lugar de segura; y el español original permanece en `rawText`.

## Deduplicación

El problema: dos colegas visitan el mismo hospital y ambos reportan un MR de NovaMed. ¿Es el
mismo escáner, o dos escáneres?

**Lo que existe hoy.** `DuplicateDetectionService` puntúa un par y produce un
`DuplicateCandidate` con una relación de `PossibleDuplicate`, `PossibleCorroboration`,
`PartialMatch`, `PossibleConflict`, o `NoMatch`, más razones codificadas y una etiqueta de versión. El mismo
cliente y una modalidad conocida compatible son compuertas obligatorias. La compatibilidad de fabricante,
modelo y antigüedad ajusta un puntaje transparente. Un observador o visita independiente empuja hacia la
corroboración en lugar de hacia la duplicación.

**Los registros nunca se fusionan automáticamente.** Un candidato es un ítem de revisión con una
`resolution` que establece un humano. Fusionar sobre un puntaje de baja certeza destruiría el rastro de
auditoría que el diseño de solo anexado existe para proteger.

`DuplicateCandidate` registra el `sourceObservationId` recién guardado, el `candidateObservationId` ya
persistido, el puntaje, la relación, las razones codificadas, la versión de algoritmo `duplicate-v1`,
el momento de creación y la resolución. `candidateInstalledBaseId` es anulable y el flujo de revisión actual
no lo usa. La vista de revisión de Customer 360 une cada observación de vuelta a su fila de equipo,
sesión, cliente y evidencia, así que la persona ve los dos registros y su texto de origen en lugar de
ids desnudos o JSON.

El ciclo de vida de resolución es deliberadamente pequeño. Un candidato creado por el detector comienza como
`Unresolved` y por lo tanto cuenta como pendiente. Una persona debe registrar explícitamente exactamente uno de
`NotDuplicate`, `SameEquipment` o `CorroboratingEvidence`. La elección actualiza solo la columna
`resolution` del candidato; lo mueve al historial resuelto y sobrevive a los reinicios de la aplicación. No
elimina, fusiona ni actualiza ninguna de las dos observaciones de equipo, su evidencia, cantidad, estado,
confianza, ni la proyección de la base instalada. Un candidato ya resuelto no se ofrece para una segunda
decisión.

**Qué mejoraría esto — PROPUESTO, no implementado:**

- Número de serie, que haría la identidad casi segura cuando esté disponible.
- Ubicación dentro de la instalación, que distingue dos escáneres idénticos en salas distintas.
- Etiquetas de sala o departamento.
- Año de instalación acotado por una segunda observación.
- Una identidad local estable de equipo que sobreviva entre observaciones, para que la corroboración
  se acumule en lugar de producir candidatos por pares.

**La regla a preservar:** una coincidencia de baja certeza produce un candidato para un humano, nunca una
fusión. Ver [DECISIONS.md](DECISIONS.md) para la decisión registrada.
