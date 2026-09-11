# Decisiones técnicas

Registro ligero de ADR. Las decisiones 1 a 9 están **Aceptadas** e implementadas; se registraron en un
formato breve de Decisión / Por qué / Compromiso y se dejan tal como fueron escritas. Las decisiones a partir de la
10 usan el formato más completo de Contexto / Decisión / Razón / Consecuencias / Estado y pueden estar
**Propuestas**, lo que significa que la pregunta sigue abierta y no se ha construido nada.

Solo las decisiones arquitectónicamente significativas pertenecen aquí. No cambie una decisión aceptada
sin agregar una nueva entrada que la reemplace.

## 1. Un corte pequeño de Electron, offline-first

**Decisión:** Usar Electron, React, TypeScript y SQLite local, con un solo flujo de extremo a extremo en lugar de un esqueleto de plataforma amplio.

**Por qué:** El desafío necesita una ruta de escritorio demostrable desde la entrada de campo hasta inteligencia persistida localmente. Una frontera de IPC tipada y estrecha preserva la seguridad de escritorio y mantiene la interfaz testeable.

**Compromiso:** El empaquetado, la autenticación, la sincronización y el despliegue de producción quedan deliberadamente pospuestos.

## 2. `node:sqlite` incorporado detrás de un adaptador de repositorio

**Decisión:** Usar el `node:sqlite` de Node 24 a través de `LocalSqliteDatabase` y puertos de repositorio.

**Por qué:** Proporciona transacciones reales sin un paso de compilación/instalación de addon nativo. El adaptador contiene su superficie de API de release candidate, de modo que otro driver pueda reemplazarlo más adelante.

**Compromiso:** El prototipo requiere un runtime moderno y compatible de Node/Electron y debería reevaluar el adaptador cuando la API se estabilice.

## 3. Ruta real de QVAC, mock de desarrollo explícito

**Decisión:** Implementar QVAC con `@qvac/sdk` 0.19.0 y mantener un mock determinista separado que se nombra `Development Mock` en tiempo de ejecución.

**Por qué:** La extracción estructurada local es la ruta del producto, mientras que el desarrollo determinista y las pruebas automatizadas no deben depender de una descarga de modelo. Un fallo de carga/inferencia de QVAC sigue siendo un error visible; la identidad del motor nunca cambia silenciosamente.

**Compromiso:** La primera ejecución real necesita el artefacto del modelo y hardware local compatible. El mock solo maneja una gramática de demostración acotada.

## 4. Inferencia en el dispositivo, no inferencia delegada

**Decisión:** Usar el handler local de completado llama.cpp de QVAC. No describir la ejecución de modelos entre pares (peer-to-peer) como parte de esta implementación.

**Por qué:** El SDK de QVAC 0.19 eliminó las APIs de delegación de inferencia/proveedor. Mantener el puerto de extracción independiente preserva un punto de extensión sin afirmar una capacidad que el SDK instalado no expone.

**Compromiso:** Cada ejecución real de inferencia consume recursos en el dispositivo del usuario.

## 5. Observaciones inmutables y proyecciones derivadas

**Decisión:** Guardar las visitas como agregados de evidencia de solo anexado (append-only) y construir Customer 360 como una proyección de lectura versionada.

**Por qué:** Un nuevo reporte de campo puede corroborar o contradecir evidencia anterior. Sobrescribir la fila previa borraría el origen, el observador, el momento, la incertidumbre y la auditabilidad.

**Compromiso:** La lógica de lectura es más deliberada que un CRUD sobre una única tabla mutable de equipos.

## 6. Lo desconocido es un estado de primera clase

**Decisión:** Distinguir `Missing`, `Known` y `DeclaredUnknown`; mantener la antigüedad como una unión discriminada.

**Por qué:** Una entrada faltante puede justificar un seguimiento, mientras que un "no lo sé" debe conservarse y no debe disparar la misma pregunta para siempre. Las antigüedades cualitativas no deben convertirse en años numéricos fabricados.

**Compromiso:** Los consumidores deben manejar explícitamente valores nulos y uniones etiquetadas.

## 7. Confianza y duplicados explicables

**Decisión:** Almacenar razones/IDs de evidencia de confianza versionados y puntajes/razones de duplicados versionados. Nunca fusionar automáticamente.

**Por qué:** Un usuario de negocio debe poder rastrear por qué aparece cierta información y distinguir entrada repetida, corroboración independiente, y conflicto.

**Compromiso:** Las heurísticas actuales son deliberadamente simples y necesitarán calibrarse contra datos reales revisados.

## 8. Ninguna política de vigencia inventada

**Decisión:** Calcular los días transcurridos desde la observación/verificación pero devolver las clasificaciones de vigencia y antigüedad como desconocidas/no configuradas.

**Por qué:** No se suministraron umbrales de negocio autoritativos. Mostrar una política inventada de rojo/ámbar/verde presentaría una invención como un hecho de dominio.

**Compromiso:** Los conteos de antigüedad permanecen no disponibles hasta que los dueños del producto definan los umbrales.

## 9. Solo fixtures sintéticos

**Decisión:** Sembrar tres instalaciones ficticias con fabricantes ficticios y marcar cada fixture como sintético.

**Por qué:** El libro de trabajo y el DOCX referenciados no estaban disponibles. Los datos sintéticos proporcionan una línea base estable para el demo y las pruebas automatizadas sin implicar una procedencia de origen que no existe.

**Compromiso:** La ingesta de hojas de cálculo y el mapeo a los registros oficiales del desafío permanecen sin implementar hasta que se proporcione el archivo fuente.

### Enmienda, 2026-09-09 — llegó el libro de trabajo y sus 20 registros son ahora la semilla

**Qué cambió:** Se suministró `Dummy_Installed_Base_Hackathon.xlsx`. Su hoja README indica que las
20 filas de `Dummy Installed Base` son "para usar como salida esperada / semilla de base de datos", así que reemplazan
por completo a las tres instalaciones inventadas. `DEVELOPMENT_SEED_KEY` pasa de
`synthetic-development-v1` a `official-dummy-v1` para que la semilla idempotente se vuelva a aplicar sobre una
base de datos ya existente. `Hospital DemoCare Pacific` conserva el id `seed-customer-democare`.

**Qué se ingirió:** 20 registros de equipos como 13 visitas en 13 instalaciones, en 13 ciudades y 10
países, usando las seis marcas ficticias de la hoja `Dummy Reference Lists`. Las filas se transcriben en una tabla
estática tipada, `src/infrastructure/seed/official-installed-base-records.ts`. **No hay ningún parser de
XLSX en tiempo de ejecución ni ninguna dependencia nueva**; los datos son estáticos y un parser agregaría una superficie de
análisis para nada.

**Por qué reemplazar en lugar de complementar:** mantener las instalaciones inventadas junto con las oficiales poblaría
la vista agregada con sitios que un revisor no puede encontrar en el archivo oficial, lo cual es peor que
cualquiera de las dos opciones por separado. La salvaguarda queda intacta: el propio libro de trabajo declara que todos sus
clientes, marcas, modelos y observaciones son sintéticos y existen únicamente para pruebas de hackathon.

**Tres reglas de mapeo, y qué se niega a inventar cada una:**

1. **Antigüedad.** Una antigüedad entera oficial `n` se convierte en `{ type: 'estimate', minYears: n, maxYears: n }`,
   nunca en `exact`. Esa es la decisión 15 de abajo, tomada por una persona. El año de instalación derivado
   sigue siendo igual a la columna oficial `Estimated Installation Year` en las 20 filas.
2. **El estado y el nivel de confianza** se transcriben de las columnas oficiales `Status` y `Confidence` en
   lugar de volver a derivarse, porque el propósito de este corte es reproducir el libro de trabajo. No cambió
   ninguna _semántica_ de estado o confianza: las reglas de derivación que aplican a las observaciones recién
   capturadas quedan intactas.
3. **El puntaje de confianza permanece `null`.** El libro de trabajo suministra un nivel y ningún puntaje. Adjuntar un
   número a un nivel que la fuente nunca cuantificó sería precisamente la fabricación que el esquema existe para
   prevenir, así que el nivel lleva razones codificadas y ningún puntaje.

**Compromiso:** la transcripción es manual, así que el libro de trabajo y el fixture pueden divergir si el
archivo oficial se revisa alguna vez. `tests/infrastructure/official-seed.test.ts` fija los conteos, el
conjunto de marcas, el conjunto de modalidades, el mapeo de antigüedad y los años de instalación derivados contra la
tabla transcrita, lo cual hace visible una divergencia pero no puede detectar un cambio hecho solo en la
hoja de cálculo.

**Retirando la semilla que reemplaza.** `seed_imports` registraba _que_ se había aplicado una clave de semilla pero
nunca _qué filas escribió_, así que no había forma segura de eliminar los datos de la semilla anterior. Debido a que la
semilla oficial reutiliza deliberadamente `seed-customer-democare`, `seed-session-democare` y
`seed-visit-democare`, una base de datos construida por la semilla anterior fallaba al iniciar con
`UNIQUE constraint failed: observation_sessions.id`. La migración `002_session_seed_ownership` agrega un
`observation_sessions.seed_key` nulable, y `applySeed` ahora retira las semillas listadas en
`SUPERSEDED_SEED_KEYS` antes de escribir. La propiedad, no una heurística, decide qué se elimina: una
sesión capturada por un usuario siempre tiene `seed_key IS NULL` y por lo tanto nunca queda en el rango. La migración
rellena las filas existentes a partir de la clave `fixture` en `evidence_items.metadata_json`, lo cual es exacto,
porque hasta ese momento la semilla era la única que escribía metadatos de evidencia y el flujo de captura no escribía ninguno.
La retirada se niega a ejecutarse en lugar de romper un vínculo si una sesión sobreviviente reemplaza a una sembrada.

**Dos cosas sobre las que el libro de trabajo se contradice a sí mismo**, transcritas tal como indican las columnas
estructuradas y señaladas en lugar de resolverse silenciosamente: las observaciones 12 y 20 llevan un modelo en la
columna `Dummy Model` mientras que su propio `Follow-up Answer` y `Notes` dicen que el modelo no era visible.
La columna estructurada es la que el README designa como la semilla, así que esa gana; el texto de seguimiento
se conserva textualmente como evidencia, así que ambas lecturas quedan inspeccionables.

## 10. El modelo reporta observaciones; las reglas derivan todo lo demás

**Contexto:** Un modelo de lenguaje al que se le pide un puntaje de confianza suministrará uno, y parecerá razonable. Lo mismo aplica a los años de instalación, los juicios de duplicados, y la procedencia.

**Decisión:** El esquema de extracción que el modelo debe satisfacer contiene solo lo que una persona podría haber dicho: modalidad, cantidad, fabricante, modelo, antigüedad aproximada, notas, y qué tan seguro sonaba el hablante. La confianza, las estimaciones de instalación, la procedencia de campo, el estado de la observación, y los puntajes de duplicados se calculan mediante reglas de dominio inspeccionables después de la extracción.

**Razón:** Pone la frontera entre "reportado" y "derivado" en el sistema de tipos en lugar de en una instrucción de prompt. Los valores derivados se vuelven versionables y testeables, y un revisor puede estar en desacuerdo con un puntaje leyendo sus códigos de razón.

**Consecuencias:** El modelo no puede expresar matices que las reglas de dominio no modelan, así que una nueva semántica derivada necesita código en lugar de cambios de prompt. Cada valor derivado lleva una versión de estrategia para que los registros almacenados sigan siendo interpretables después de que cambien las reglas.

**Estado:** Aceptada, implementada.

## 11. El modelo más pequeño que cumple con el estándar

**Contexto:** El registro de QVAC ofrece modelos de completado desde 0.6B hasta bien más allá de lo que puede ejecutar un laptop de campo, y el SDK incluye doce plugins de worker.

**Decisión:** Usar `QWEN3_600M_INST_Q4` y habilitar exactamente un plugin. Escalar a un modelo más grande solo después de medir el más pequeño contra el corpus de extracción y registrar qué casos falló.

**Razón:** El tamaño del modelo cuesta tiempo de descarga, disco, RAM, latencia y batería en cada dispositivo en el campo. La tarea de extracción está fuertemente restringida por un esquema JSON y un vocabulario de seis valores de modalidad, así que la corrección estructural se impone fuera del modelo.

**Consecuencias:** La calidad de extracción está acotada por un modelo pequeño, lo cual hace que el corpus de prueba adversarial en TESTING.md sea el mecanismo que detecta cuándo se ha alcanzado ese límite. La ruta de escalado a `QWEN3_1_7B_INST_Q4` está documentada en MODEL_STRATEGY.md y cuesta aproximadamente 2.8× la descarga.

**Estado:** Aceptada, implementada.

## 12. Captura de voz mediante Whisper de QVAC

**Contexto:** Alguien caminando por un pasillo de hospital preferiría hablar en lugar de escribir. `SpeechToTextPort` y la fuente de evidencia `Voice` ya existen como puntos de extensión tipados, sin implementar.

**Decisión:** Cuando la voz se lance, usar el plugin de transcripción whispercpp de QVAC con un modelo Whisper diminuto, alimentando su transcripción al pipeline de extracción existente sin cambios.

**Razón:** Reutiliza todo el pipeline posterior, agrega alrededor de 42 MiB en lugar de un segundo modelo grande, y mantiene el audio en el dispositivo. La transcripción y la extracción siguen siendo aspectos separados, así que un error de transcripción es visible como texto antes de convertirse en datos estructurados.

**Consecuencias:** Un segundo ciclo de vida de modelo que gestionar, un segundo plugin en el bundle, y una pregunta abierta sobre si los dos modelos pueden ser residentes simultáneamente, lo cual necesita primero una cifra de RAM medida. El estándar de calidad debe definirse contra el vocabulario hospitalario, no la tasa de error de palabras general.

**Estado:** Propuesta. Nada implementado.

## 13. La deduplicación permanece determinista y nunca fusiona automáticamente

**Contexto:** Dos colegas que visitan el mismo hospital reportarán ambos un MR de NovaMed. Decidir si eso es un escáner o dos es el problema central de calidad de datos, y la similitud por embeddings es la respuesta tentadora obvia.

**Decisión:** Mantener el modelo transparente de candidatos puntuados. El mismo cliente y una modalidad conocida compatible son compuertas obligatorias; el fabricante, el modelo y la compatibilidad de antigüedad ajustan un puntaje versionado con razones codificadas. Los candidatos se presentan para resolución humana y nunca se fusionan automáticamente.

**Razón:** Una fusión automática sobre un puntaje de baja certeza destruye el rastro de auditoría que el diseño de solo anexado existe para proteger, y es irrecuperable. Un candidato equivocado es un ítem de revisión; una fusión equivocada es evidencia perdida.

**Consecuencias:** Los duplicados se acumulan hasta que alguien los revisa, y las heurísticas necesitan calibrarse contra datos reales revisados que aún no existen. El número de serie y la ubicación dentro de la instalación mejorarían sustancialmente el emparejamiento y hoy no se capturan.

**Estado:** Aceptada para la puntuación actual; las mejoras están Propuestas. Ver DATA_SCHEMA.md.

## 14. La base de datos local no está cifrada en reposo

**Contexto:** El archivo SQLite guarda nombres de instalaciones, detalles de equipos, identidad del reportero, y texto de observación textual, en laptops que viajan a hospitales.

**Decisión:** El prototipo depende del aislamiento de cuentas del sistema operativo y del cifrado de disco completo. Ningún cifrado de base de datos a nivel de aplicación.

**Razón:** `node:sqlite` no proporciona cifrado, y agregar un driver cifrado nativo reintroduciría el paso de compilación nativa que la decisión 2 evitó. Para un prototipo con datos sintéticos, el compromiso es aceptable.

**Consecuencias:** El robo del dispositivo es una brecha no mitigada, registrada como tal en PRIVACY_OFFLINE.md. Cualquier despliegue real debe revisar esto antes del uso en campo, lo cual probablemente implique cambiar el driver de persistencia.

**Estado:** Aceptada para el prototipo. Revisarla está Propuesto y es bloqueante para producción.

## 15. Las antigüedades enteras oficiales se mapean a `estimate`, no a `exact` (`X-06`)

**Contexto:** Los 20 registros oficiales del libro de trabajo del desafío llevan una antigüedad entera simple. La
unión de antigüedad en `src/domain/model/age.ts` ofrece `exact`, `estimate`, `range`, `qualitative`, `unknown`.
Quince de las veinte respuestas de seguimiento oficiales que produjeron esos enteros dicen "around",
"about", "maybe", "roughly", "I think" o "my best estimate". `P2-D1` en `docs/ROADMAP.md` designa
esto como una puerta de decisión humana, no una que un agente implementador pueda tomar, porque establece la línea base de
honestidad para cada registro sembrado y para todo lo que Customer 360 y el Dashboard muestran a partir de él.

**Decisión (humana, 2026-09-09):** Una antigüedad entera oficial `n` se mapea a
`{ type: 'estimate', minYears: n, maxYears: n }`, **nunca** a `{ type: 'exact', years: n }`.

**Razón:** Los enteros de origen son respuestas reportadas y matizadas, no mediciones. Registrar una afirmación
matizada como exacta incrustaría una violación de la regla 10 de `AGENTS.md` —nunca convertir incertidumbre
humana en certeza de máquina— dentro de los propios datos del demo.

**Consecuencias:**

1. `deriveInstallationEstimate` devuelve un único `year` cuando `minYears === maxYears`, así que los años de
   instalación derivados siguen coincidiendo exactamente con la columna oficial `Estimated Installation Year` (fila 1:
   2026 − 7 = 2019, oficial 2019). No se introduce ninguna divergencia ahí.
2. `capture-workflow-service.ts` deriva `status` como `Estimated` siempre que la antigüedad sea una estimación o
   un rango. Esta divergencia se acepta por ahora; es evidencia independiente de que el estado debería provenir de
   cómo se obtuvo la información en lugar de la precisión de la antigüedad, lo cual `B-01` aborda por separado. No es
   una razón para reconsiderar esta decisión.

   **Reducida en la implementación, 2026-09-09.** La consecuencia es menor de lo anticipado. Se escribió esperando que
   cada fila sembrada se convirtiera en `Estimated`. La semilla es una transcripción, no una captura, así que lleva la
   columna oficial `Status` directamente y conserva los 13 `Reported` y 7 `Estimated` del libro de trabajo. La regla de
   derivación queda intacta y la divergencia que describe ahora solo aplica a las observaciones capturadas mediante el
   flujo de trabajo, que es exactamente el alcance que cubre `B-01`.

**Estado:** Aceptada (decisión humana, resuelve `X-06` / `P2-D1`). **Implementada** en `P2-S2`:
`src/infrastructure/seed/development-seed.ts` mapea cada antigüedad entera oficial mediante
`officialAge`, y `tests/infrastructure/official-seed.test.ts` falla si alguna antigüedad sembrada se
registra como `exact`. Incorporada en la enmienda de la decisión 9 de arriba.

## 16. El estado de la observación se pregunta, y una declaración explícita del origen prevalece sobre la precisión de la antigüedad (`B-01`, `B-02`)

**Contexto:** `status` se derivaba únicamente de la precisión de la antigüedad, así que `Confirmed` y `Unknown` eran
inalcanzables y `Reported` significaba "la antigüedad no era una estimación" en lugar de "alguien me lo dijo". La
Lógica Oficial de Preguntas del Agente hace del paso 10 una pregunta, y del paso 12, la confirmación de revisión, el
único paso derivado que marca `Required?: Yes`.

**Decisión:**

1. El estado lo decide un `observationBasis` a nivel de sesión, que se establece ya sea por una declaración
   inequívoca de origen en las propias palabras del observador o por su respuesta a una pregunta de seguimiento
   `Preferred`. Los cuatro valores oficiales se mapean uno a uno sobre él, y una pregunta rechazada almacena
   `Unknown`.
2. La regla derivada de la antigüedad sobrevive solo como respaldo para una observación cuyo origen nunca se
   estableció. Ya no anula un origen declarado.
3. Guardar requiere una confirmación explícita de un resumen determinista. Alcanzar `READY_FOR_REVIEW` no es
   una confirmación, y una corrección retira una ya dada.

**Razón:** El estado y la certeza son ejes diferentes, y dejar que la precisión de la antigüedad decida el estado
volvía decorativo el vocabulario de cuatro valores. `ROADMAP.md` había propuesto mantener el `Estimated` derivado de
la antigüedad como una anulación y preguntar solo una pregunta de dos vías. Eso fue acotado por una persona el 2026-09-09:
"vi un MR que parecía tener unos siete años" debe ser `Confirmed` con una antigüedad `Uncertain`, lo cual una anulación por
antigüedad haría imposible, y la pregunta oficial ofrece tres respuestas en lugar de dos. `ROADMAP.md` también decía no
inferir el estado a partir de la redacción; la regla más estrecha adoptada aquí lee solo marcadores de procedencia
inequívocos y pregunta siempre que estén ausentes, así que nada se infiere del silencio.

**Consecuencias:** Ahora hay un clasificador determinista breve en `src/domain/rules/`, aplicado a las propias
palabras del observador y a la respuesta. No resuelve nada de lo que no está seguro, lo cual enruta el caso hacia la
pregunta. El esquema de extracción, el prompt y el modelo quedan intactos: la procedencia se deriva mediante reglas,
consistente con la decisión 10. Los pesos de confianza y la semántica de certeza no cambian. Los registros históricos
conservan el estado con el que fueron guardados.

**Estado:** Aceptada, implementada en `P3-S3`. La procedencia por grupo de equipo, y mostrar el estado y la
procedencia en Customer 360, no están en el alcance aquí; lo segundo es `P3-S4`.

## 17. Una contradicción dentro de una captura se pregunta, nunca se resuelve por el orden de los mensajes (`E-06`)

**Decisión:** Cuando una declaración posterior suministra un valor que difiere de un valor que la misma captura ya
tiene, el flujo de trabajo no simplemente lo sobrescribe.

1. Los IDs de evidencia se acumulan en el campo. Un valor que cambia conserva los IDs de evidencia del valor
   que reemplazó, así que ambas afirmaciones siguen siendo alcanzables. Esto aplica por igual a las fusiones de
   extracción, las respuestas de seguimiento, los desconocidos declarados y las correcciones de revisión.
2. Se distinguen tres resultados, y ninguno de ellos mira los valores en sí. Un campo que estaba
   `Missing`, `DeclaredUnknown`, o que ya tenía el mismo valor, se enriquece. Una redacción que corrige
   explícitamente la afirmación anterior es una autocorrección y se toma el valor posterior. Cualquier otra cosa
   es una contradicción.
3. Una contradicción mantiene activo el valor posterior para que la revisión tenga algo que mostrar, marca el
   campo `Uncertain`, y encola un seguimiento `Required` que nombra ambas afirmaciones. La revisión no se puede
   alcanzar y cualquier confirmación existente se retira hasta que se responda.

**Razón:** `mergeEquipment` antes sobrescribía cualquier valor conocido siempre que una extracción devolviera uno
no nulo, sin comparación ni registro. Eso convertía "era NovaMed... bueno, quizá Orion" en un hecho almacenado con
confianza total, elegido por el orden de los mensajes, que es exactamente la fabricación que prohíbe la regla 10.
`ROADMAP.md` requiere que el campo permanezca conocido, se vuelva `Uncertain`, y produzca un seguimiento que nombre
ambos valores, y prohíbe decidir cuál es el correcto.

**Consecuencias:** `CaptureEquipmentDraft` lleva los desacuerdos abiertos mientras duran; no se persiste nada nuevo
y no se necesitó ninguna migración, porque los IDs de evidencia acumulados y las filas de evidencia de solo anexado
ya responden qué se dijo primero, qué se dijo después, y qué valor se aceptó. La autocorrección se reconoce mediante
una lista determinista breve de frases explícitas, y la redacción matizada siempre gana sobre ella, así que una
suposición nunca se confunde con una corrección. Los pesos de confianza, la semántica de certeza, `observationBasis`,
`projectionSignature`, la semilla oficial, el esquema de extracción y el modelo quedan intactos. `DuplicateCandidate`
es un mecanismo separado para observaciones entre sesiones guardadas y no está involucrado.

**Estado:** Aceptada, implementada en `P3-S6`. Una modalidad reformulada está fuera del alcance de la fusión de
extracción, porque la extracción agrupa el equipo por modalidad; esa corrección pasa por la vía de corrección de
revisión, que preserva los IDs de evidencia anteriores de la misma manera.

## 18. `QWEN3_4B_INST_Q4_K_M` es la configuración de demo recomendada; el valor por defecto de producción sigue siendo `QWEN3_600M_INST_Q4`

**Contexto:** `docs/qvac-eval-runs/4b-2026-09-10T18-16-39-837Z.json`, referenciado desde el
apéndice del 2026-09-10 en `docs/MODEL_STRATEGY.md`, midió `QWEN3_4B_INST_Q4_K_M` en 82.6% de precisión
general de campo contra `extraction-corpus-v1` (EN 84.7%, ES 76.7%, adversarial 82.4%, 11
valores fabricados, 7/30 aprobación total) — materialmente mejor que el 43.8–49.8% registrado para el
valor por defecto de producción `QWEN3_600M_INST_Q4` a lo largo de sus propias ejecuciones. Una persona aprobó
`QWEN3_4B_INST_Q4_K_M` como la configuración recomendada y documentada para el demo próximo.

**Decisión:** La unión `QvacModelDescriptor` de `QvacObservationExtractionService` y sus reexportaciones
ahora incluyen `QWEN3_4B_INST_Q4_K_M`, y `src/main/composition-root.ts` lee una variable de entorno
explícita `CIB_QVAC_MODEL` (`600m` o `4b`; los valores no reconocidos fallan explícitamente) para
seleccionarlo. **El valor por defecto global/de producción, usado por `npm run dev`, `npm test`, y cualquier
ejecución que deje `CIB_QVAC_MODEL` sin definir, sigue siendo `QWEN3_600M_INST_Q4`.** `QWEN3_600M_INST_Q4`
sigue disponible y documentado como un respaldo rápido para el propio demo, seleccionado de la misma manera con
`CIB_QVAC_MODEL=600m`.

**Razón:** Cambiar el valor por defecto global tan cerca del demo desestabilizaría los flujos de desarrollo y
prueba que no se construyeron ni se midieron contra el tiempo de carga y la latencia del modelo 4B (162,579 ms
de carga, hasta 17,013 ms de latencia por caso en la ejecución de comparación anterior en `PERFORMANCE_BUDGETS.md`).
Convertir la elección de modelo del demo en una variable de entorno explícita y documentada lleva la mejora de
calidad medida al demo sin tocar el valor por defecto del que depende el flujo de trabajo de cualquier otra persona.

**Consecuencias:** Sigue sin haber ningún respaldo en la nube; `@qvac/sdk` sigue siendo el único runtime de
inferencia en ambas configuraciones. Quien presenta el demo debe establecer `CIB_QVAC_MODEL=4b` deliberadamente —
ver el [README](../README.md#modelo-recomendado-para-la-demo)— o la aplicación ejecutará silenciosamente el
valor por defecto 600M, lo cual es un comportamiento correcto, no un defecto, pero vale la pena saberlo antes de
presentar. El prompt, el esquema y el ajuste del modelo quedan intactos; `QWEN3_4B_INST_Q4_K_M` todavía falla en
23/30 casos del corpus y nunca emite `Uncertain`, así que esto es una decisión de configuración de demo, no una
afirmación de que se cumpla el estándar de calidad de `docs/TESTING.md`.

**Estado:** Aceptada (decisión humana, 2026-09-10), implementada.

## 19. Dictado de voz implementado mediante el motor whisper de QVAC; se seleccionó `WHISPER_TINY_Q8_0`; la coexistencia de RAM con el modelo de completado queda sin medir

**Contexto:** La Capacidad 2 de `docs/MODEL_STRATEGY.md` ("Voz a texto") había permanecido como PLANIFICADA desde
que `SpeechToTextPort` quedó como un stub. La solicitud de funcionalidad era permitir que un colega de campo dicte una
observación, la transcriba localmente mediante `@qvac/sdk`, y coloque la transcripción en el campo de texto
existente para revisión — nunca enviada automáticamente, sin cambio en el flujo existente de captura/extracción de
texto.

**Decisión:** `SpeechToTextPort` se implementó, no solo se dejó como stub: ahora refleja el ciclo de vida de
`ObservationExtractionPort` (`initialize`/`getRuntimeInfo`/`transcribe`/`dispose`).
`QvacSpeechToTextService` (`src/infrastructure/qvac/qvac-speech-to-text.ts`) lo implementa contra
`transcribe()`/`loadModel()`/`unloadModel()` de `@qvac/sdk`, seleccionando `WHISPER_TINY_Q8_0`
(≈42 MiB) —el candidato **multilingüe** más pequeño del registro— por encima del `WHISPER_SPANISH_TINY_Q8_0`,
más pequeño en nombre pero solo en español, porque el propio posicionamiento de este producto requiere entrada en
español _y_ en inglés. `language: 'auto'` y `translate: false` se establecen explícitamente para que la
transcripción se mantenga en el idioma que realmente se habló. `DevelopmentMockSpeechToTextService`
refleja la división mock/producción de la capacidad de extracción para `npm run dev` / `npm test` /
`npm run app:smoke`. El renderer graba mediante `MediaRecorder` + `getUserMedia`, decodifica el resultado
con `AudioContext.decodeAudioData`, y lo vuelve a codificar como WAV PCM de 16 bits (`src/renderer/src/audio/wav-encoder.ts`) antes de enviarlo por IPC — la propia salida webm/opus de MediaRecorder no está entre
los `SUPPORTED_AUDIO_FORMATS` de QVAC. `src/main/voice-transcription.ts` escribe ese búfer en un archivo
temporal del sistema operativo de un solo uso solo durante la duración de la llamada de transcripción y siempre lo elimina
después; ningún audio crudo se persiste jamás. La transcripción se agrega al `<textarea>` de texto
existente para que el observador la revise/edite; nada se envía automáticamente, y el flujo de Enviar, el prompt de
extracción, el esquema y el modelo quedan todos intactos.

**Razón:** La voz es el modo natural de captura para alguien que camina por un pasillo de hospital, y el
puerto ya existía como un marcador nombrado exactamente para esto. Reutilizar la forma existente del ciclo de vida de
`ObservationExtractionPort` (en lugar de inventar una nueva) mantiene ambas capacidades simétricas e igualmente
testeables. Derivar el WAV a partir de la propia decodificación del navegador de su propia grabación evita agregar una
dependencia de transcodificación de audio (por ejemplo ffmpeg) solo para satisfacer la lista de formatos soportados de
QVAC.

**Consecuencias:** Ahora dos adaptadores independientes llaman cada uno a `heartbeat()`, `loadModel`, y
`unloadModel`, lo cual `docs/QVAC_ARCHITECTURE.md` ya había señalado como el disparador para construir un
`QvacRuntime` compartido — no construido aquí, para evitar mezclar una refactorización con un cambio de
funcionalidad. Si una sesión usa voz mientras el modelo de completado ya está cargado, ambos modelos permanecen
residentes hasta la liberación de recursos; este costo de coexistencia de RAM **no se ha medido**, y
`docs/MODEL_STRATEGY.md` lo registra como una pregunta abierta en lugar de resuelta. Tampoco existe ninguna
medición de tasa de error de palabras; `npm run qvac:voice-smoke` demuestra que el pipeline se ejecuta en hardware
real, no que la transcripción sea precisa. Los "Artefactos de audio" de `docs/PRIVACY_OFFLINE.md` permanecen
marcados como nunca persistidos (por diseño, no por omisión), y su fila "Transcripciones de voz" se corrigió para
señalar que una transcripción no es una categoría de evidencia distinta — se convierte en texto ordinario una vez
enviada.

**Estado:** Aceptada, implementada. El estándar de calidad (WER) y la medición de coexistencia de RAM siguen
abiertos, rastreados en `docs/MODEL_STRATEGY.md`.

## 20. El Panel gana bandas de antigüedad descriptivas y estado/confianza/enriquecimiento proyectados; la vigencia sigue sin política (reemplaza parcialmente la decisión 8)

**Contexto:** La decisión 8 dejó `agingEquipment` en `null` y `agingPolicy` en `'Not configured'` porque
nadie con autoridad de producto había suministrado umbrales de negocio, y `docs/ROADMAP.md` (`P5-S3`) fijó
como no-objetivo explícito "no agregar umbrales de antigüedad ni una política de antigüedad" hasta que
alguien lo hiciera. El Panel seguía cumpliendo solo el mínimo de agregación y no respondía preguntas que un
usuario de negocio haría de inmediato: cuántos equipos hay por país, qué tan confiable es la información, o
qué tan viejo es el parque instalado, aunque la antigüedad estructurada ya estuviera en cada grupo
proyectado.

**Decisión:** Un producto owner (la persona que da esta instrucción, 2026-09-10) suministró explícitamente
tres bandas de antigüedad — `0–5 años`, `6–10 años`, `Más de 10 años` — como una **distribución descriptiva
de los años reportados**, no como una política de vigencia/obsolescencia; no se usan las etiquetas
Reciente/Envejeciendo/Obsoleto porque el desafío no define esos criterios de negocio o clínicos. Las bandas
viven en `src/domain/rules/age-bands.ts` (`AGE_BANDS`), no en el componente React, para que un cambio de
límites futuro no requiera rehacer el Panel. `classifyAgeBand` clasifica cada `ApproximateAge` estructurado
—nunca texto libre visible— y coloca una `estimate`/`range` que cruza dos bandas en un bucket
`Rango/indeterminado` explícito en lugar de redondear a un extremo, y una edad `qualitative` recibe el mismo
bucket en lugar de que se le fabrique un número. `DashboardView` (`src/application/contracts/queries.ts`)
reemplaza `agingEquipment`/`agingPolicy` por `ageKnown`, `ageUnknown` y `ageBands`, y añade
`equipmentByCountry` (cantidad proyectada por país, sustituyendo `observationsByCountry`),
`equipmentByStatus`, `equipmentByConfidence`, `pendingDuplicateCandidates` y `fieldEnrichmentGaps`
(`Missing` contado aparte de `DeclaredUnknown`, por la misma razón que la decisión 6). Todas estas métricas
se derivan de la proyección de Customer 360 ya existente (`getCustomer360`/`InstalledBaseItem`); no se tocó
el esquema de persistencia, la extracción QVAC, ni la lógica de deduplicación.

**Razón:** La decisión 8 protegía contra inventar un umbral sin autoridad para hacerlo; ahora existe esa
autoridad para una distribución puramente descriptiva, y las bandas se documentan como tal en la propia
interfaz ("Distribución descriptiva, no una política de vigencia"). La vigencia (`freshnessStatus`, días
desde la observación/verificación) es un eje distinto — cuánto hace que se vio el equipo, no cuántos años
tiene — y la decisión 8 sigue vigente ahí sin cambios: `freshnessStatus` permanece `'Unknown'` porque ningún
umbral rojo/ámbar/verde fue suministrado para ese eje.

**Consecuencias:** `docs/ROADMAP.md` `P5-S3` queda desactualizado en su no-objetivo de antigüedad; sigue
siendo correcto en no agregar identificación de oportunidades ni un mapa, que este cambio tampoco añade.
Cualquier consumidor futuro de `DashboardView` debe leer `ageBands`/`ageKnown`/`ageUnknown` en lugar de los
campos retirados. Si alguna vez se define una política real de vigencia u obsolescencia, debe ser una nueva
decisión separada de esta — las bandas de aquí no deben reinterpretarse silenciosamente como esa política.

**Estado:** Aceptada, implementada.
