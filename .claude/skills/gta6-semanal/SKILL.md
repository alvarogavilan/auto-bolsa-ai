---
name: gta6-semanal
description: Revisión semanal de la página faceless de GTA 6 a partir de scoreboard.csv. Top 3 y bottom 3, medianas por pilar, hora y formato, qué doblar y qué recortar, reglas nuevas para learning.md y experimentos de la próxima semana. Úsala cuando el usuario pida "revisión semanal", "cómo va la página" o "qué funciona".
---

# Revisión semanal de la página GTA 6

1. Ejecuta `python3 gta6-pagina/pagina.py revision --dias 7`. Añade la revisión a `gta6-pagina/learning.md`.
2. Si `scoreboard.csv` está vacío o tiene pocas filas con métricas de 24 h o más, dilo claramente. Explica al usuario, paso a paso, cómo apuntar las métricas: dónde se ven en cada app y a qué horas (12 h, 24 h, 72 h). No saques conclusiones sin datos.
3. Con los datos:
   - Top 3 y bottom 3, con una frase de por qué crees que funcionaron o fallaron.
   - Mediana por pilar, hora y formato. Qué **doblar** (≥30 % sobre la mediana) y qué **recortar** (≤70 %).
   - Resultado de cada experimento (`test_name`): ¿se mantiene, se descarta o hay que repetirlo?
4. Escribe en `learning.md`, en *Lo que funciona* y *Lo que no funciona*, cada lección como una regla corta y accionable («Los clips de persecución a las 21:30 rinden el doble que a las 13:00»).
5. Propón **3 experimentos** para la semana que viene (una variable cada uno) y los cambios de horario o mezcla de pilares para `playbook.md`. Pide aprobación antes de editar el playbook.
6. Envía al usuario un resumen de 5 líneas: qué funcionó, qué no, qué cambia y los experimentos.
