import { standaloneDemoDashboard } from "./demo-dashboard-standalone";
import { DEMO_HISTORY_OUTCOMES_CODE, DEMO_HISTORY_OUTCOMES_STYLE } from "./demo-history-outcomes";
import { DEMO_LIVE_PRICES_SCRIPT } from "./demo-live-prices";
import { DEMO_OPERATION_DOSSIERS_CODE, DEMO_OPERATION_DOSSIERS_STYLE } from "./demo-operation-dossiers";
import { DEMO_ZERO_POSITION_DIAGNOSTICS_CODE, DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE } from "./demo-zero-position-diagnostics";

export async function demoDashboard(): Promise<Response> {
  const response = standaloneDemoDashboard();
  const liveScript = DEMO_LIVE_PRICES_SCRIPT.replace(
    "})();\n</script>",
    `${DEMO_HISTORY_OUTCOMES_CODE}\n${DEMO_OPERATION_DOSSIERS_CODE}\n${DEMO_ZERO_POSITION_DIAGNOSTICS_CODE}\n})();\n</script>`,
  );
  let html = await response.text();
  html = html
    .replace("</head>", `${DEMO_HISTORY_OUTCOMES_STYLE}${DEMO_OPERATION_DOSSIERS_STYLE}${DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE}</head>`)
    .replace("Cuenta equivalente de 50 €, separada del capital técnico multi-estrategia.", "Cuenta equivalente de 50 €; no suma ficticia de nueve carteras.")
    .replace("NO APTO PARA REAL", "NO APTO LIVE")
    .replace("Posiciones abiertas y cerradas", "Posiciones vigentes · Posiciones abiertas y cerradas")
    .replace("Mismo estado contable de Resumen, sin bloques heredados.", "Estado exacto del mismo capital mostrado en Resumen.")
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String")
    .replace("</body>", `${liveScript}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
