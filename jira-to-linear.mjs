#!/usr/bin/env node
import "dotenv/config";
import { select, checkbox, confirm, input, password } from "@inquirer/prompts";
import { fetch } from "undici";
import { LinearClient } from "@linear/sdk";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { URL } from "url";

const CONFIG_PATH = join(homedir(), ".jira-to-linear.json");
const OAUTH_PORT = 9876;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;

// OAuth credentials - se pueden sobreescribir con variables de entorno
const JIRA_CLIENT_ID = process.env.JIRA_CLIENT_ID || "jFhDVgInCBiN7zcXWYh3nrP9XvdIF8tD";
const JIRA_CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET || "";
const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID || "a4cdef6febf8d5c63b5032a1bc597e2d";
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET || "";

// Symbol for exit
const EXIT_SYMBOL = Symbol("exit");

// Select con soporte de ESC para salir
async function selectWithEsc(options) {
  const controller = new AbortController();

  // Listener para ESC
  const onKeypress = (data) => {
    if (data.toString() === "\x1b") {
      controller.abort();
    }
  };

  process.stdin.setRawMode?.(true);
  process.stdin.on("data", onKeypress);

  try {
    const result = await select({
      ...options,
      message: `${options.message} (ESC para salir)`,
    }, { signal: controller.signal });
    return result;
  } catch (e) {
    if (e.name === "AbortPromptError" || controller.signal.aborted) {
      return EXIT_SYMBOL;
    }
    throw e;
  } finally {
    process.stdin.removeListener("data", onKeypress);
    process.stdin.setRawMode?.(false);
  }
}

// PKCE helpers
function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

// Open browser cross-platform
async function openBrowser(url) {
  const { exec } = await import("child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}

// OAuth flow
async function oauthFlow(authUrl, tokenUrl, clientId, scopes, extraTokenParams = {}) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const fullAuthUrl = `${authUrl}?${authParams}`;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${OAUTH_PORT}`);

      if (reqUrl.pathname === "/callback") {
        const code = reqUrl.searchParams.get("code");
        const returnedState = reqUrl.searchParams.get("state");
        const error = reqUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Error de autorizacion</h1><p>Puedes cerrar esta ventana.</p>");
          server.close();
          reject(new Error(error));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Error: state no coincide</h1>");
          server.close();
          reject(new Error("State mismatch"));
          return;
        }

        // Exchange code for token
        try {
          const tokenParams = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
            ...extraTokenParams,
          });

          const tokenRes = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenParams,
          });

          if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            throw new Error(`Token error: ${tokenRes.status} ${errText}`);
          }

          const tokens = await tokenRes.json();

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Autorizacion exitosa!</h1><p>Puedes cerrar esta ventana y volver a la terminal.</p>");
          server.close();
          resolve(tokens);
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><p>${e.message}</p>`);
          server.close();
          reject(e);
        }
      }
    });

    server.listen(OAUTH_PORT, () => {
      console.log(`\n🌐 Abriendo navegador para autorización...`);
      console.log(`   Si no se abre, visita: ${fullAuthUrl}\n`);
      openBrowser(fullAuthUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout"));
    }, 5 * 60 * 1000);
  });
}

// Jira OAuth
async function jiraOAuth() {
  console.log("\n📋 Iniciando sesión en Jira...");

  const tokens = await oauthFlow(
    "https://auth.atlassian.com/authorize",
    "https://auth.atlassian.com/oauth/token",
    JIRA_CLIENT_ID,
    "read:jira-work read:jira-user offline_access",
    { audience: "api.atlassian.com", client_secret: JIRA_CLIENT_SECRET }
  );

  // Get accessible resources (Jira sites)
  const resourcesRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const resources = await resourcesRes.json();

  if (!resources.length) {
    throw new Error("No tienes acceso a ningún sitio de Jira");
  }

  let cloudId, siteName, siteUrl;
  if (resources.length === 1) {
    cloudId = resources[0].id;
    siteName = resources[0].name;
    siteUrl = resources[0].url;
  } else {
    const choice = await select({
      message: "Selecciona el sitio de Jira:",
      choices: resources.map((r) => ({ name: `${r.name} (${r.url})`, value: r })),
    });
    cloudId = choice.id;
    siteName = choice.name;
    siteUrl = choice.url;
  }

  // Get user info
  const meRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json();

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    cloudId,
    siteName,
    siteUrl,
    email: me.emailAddress,
    displayName: me.displayName,
  };
}

// Refresh Jira token
async function refreshJiraToken(refreshToken) {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: JIRA_CLIENT_ID,
      client_secret: JIRA_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("Failed to refresh Jira token");
  return res.json();
}

// Linear OAuth
async function linearOAuth() {
  console.log("\n📐 Iniciando sesión en Linear...");

  const tokens = await oauthFlow(
    "https://linear.app/oauth/authorize",
    "https://api.linear.app/oauth/token",
    LINEAR_CLIENT_ID,
    "read,write",
    { client_secret: LINEAR_CLIENT_SECRET }
  );

  // Get user info
  const linear = new LinearClient({ accessToken: tokens.access_token });
  const viewer = await linear.viewer;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userId: viewer.id,
    displayName: viewer.name,
    email: viewer.email,
  };
}

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function setupCredentials(forceReset = false) {
  let config = forceReset ? {} : loadConfig();
  let needsSave = false;

  // Jira OAuth
  if (config.jira?.accessToken && config.jira?.cloudId) {
    // Refresh token si existe
    if (config.jira.refreshToken) {
      try {
        const newTokens = await refreshJiraToken(config.jira.refreshToken);
        config.jira.accessToken = newTokens.access_token;
        if (newTokens.refresh_token) {
          config.jira.refreshToken = newTokens.refresh_token;
        }
        needsSave = true;
      } catch (e) {
        console.log("⚠️ Token de Jira expirado, necesitas volver a iniciar sesión");
        delete config.jira;
      }
    }
  }

  if (!config.jira) {
    try {
      config.jira = await jiraOAuth();
      needsSave = true;
    } catch (e) {
      console.error("❌ Error conectando a Jira:", e.message);
      return setupCredentials();
    }
  }
  console.log(`✅ Jira: ${config.jira.displayName} (${config.jira.siteName})`);

  // Linear OAuth
  if (!config.linear?.accessToken) {
    try {
      config.linear = await linearOAuth();
      needsSave = true;
    } catch (e) {
      console.error("❌ Error conectando a Linear:", e.message);
      return setupCredentials();
    }
  }
  console.log(`✅ Linear: ${config.linear.displayName}`);

  // Guardar solo si hubo cambios
  if (needsSave) {
    saveConfig(config);
    console.log(`💾 Credenciales guardadas\n`);
  }

  return config;
}

let config;

async function jiraGET(path, params = {}) {
  // OAuth uses Atlassian API gateway with cloudId
  const baseUrl = `https://api.atlassian.com/ex/jira/${config.jira.cloudId}`;
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.jira.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Jira GET ${url} -> ${res.status} ${res.statusText}\n${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Jira Cloud suele devolver description en ADF (JSON). Convertimos lo básico a Markdown.
// Si algo no se reconoce, lo metemos como JSON “pretty” en un bloque.
export function adfToMarkdown(adf) {
  if (!adf || typeof adf !== "object") return "";
  if (!adf.content || !Array.isArray(adf.content)) return "";

  const walk = (node) => {
    if (!node) return "";
    const { type } = node;

    if (type === "text") {
      let t = node.text ?? "";
      // marks: link, strong, em, code
      if (Array.isArray(node.marks)) {
        for (const m of node.marks) {
          if (m.type === "strong") t = `**${t}**`;
          if (m.type === "em") t = `*${t}*`;
          if (m.type === "code") t = `\`${t}\``;
          if (m.type === "link") {
            const href = m.attrs?.href;
            if (href) t = `[${t}](${href})`;
          }
        }
      }
      return t;
    }

    if (type === "paragraph") {
      const inner = (node.content || []).map(walk).join("");
      return inner.trim() ? `${inner}\n` : "\n";
    }

    if (type === "heading") {
      const level = node.attrs?.level ?? 1;
      const inner = (node.content || []).map(walk).join("").trim();
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${inner}\n\n`;
    }

    if (type === "bulletList") {
      return (node.content || []).map(walk).join("") + "\n";
    }

    if (type === "orderedList") {
      // numeración simple
      const items = node.content || [];
      return (
        items
          .map((it, idx) => {
            const li = walk(it).trimEnd();
            return li
              .split("\n")
              .filter(Boolean)
              .map((line, i) => (i === 0 ? `${idx + 1}. ${line}` : `   ${line}`))
              .join("\n");
          })
          .join("\n") + "\n\n"
      );
    }

    if (type === "listItem") {
      const inner = (node.content || []).map(walk).join("").trimEnd();
      // lo devolveremos sin prefijo; el padre (bullet/ordered) lo compone
      return inner
        .split("\n")
        .filter(Boolean)
        .map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
        .join("\n") + "\n";
    }

    if (type === "codeBlock") {
      const inner = (node.content || []).map(walk).join("");
      return `\n\`\`\`\n${inner}\n\`\`\`\n\n`;
    }

    // fallback: intenta descender
    if (Array.isArray(node.content)) {
      return node.content.map(walk).join("");
    }

    return "";
  };

  try {
    return adf.content.map(walk).join("").trim();
  } catch {
    return "```json\n" + JSON.stringify(adf, null, 2) + "\n```";
  }
}

async function listJiraProjects() {
  const out = [];
  let startAt = 0;

  while (true) {
    const data = await jiraGET("/rest/api/3/project/search", {
      startAt,
      maxResults: 50,
    }); // endpoint oficial de búsqueda de proyectos :contentReference[oaicite:2]{index=2}

    out.push(...(data.values || []));
    if (data.isLast) break;
    startAt += data.maxResults || 50;
  }

  // ordena por nombre
  out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return out;
}

async function jiraSearchIssues(jql, fields = []) {
  const pageSize = 50;
  let startAt = 0;
  const issues = [];

  while (true) {
    const data = await jiraGET("/rest/api/3/search/jql", {
      jql,
      startAt,
      maxResults: pageSize,
      fields: fields.length ? fields.join(",") : undefined,
    });

    const batch = data.issues || [];
    issues.push(...batch);

    const total = data.total ?? issues.length;
    startAt += batch.length;

    if (!batch.length || issues.length >= total) break;
  }

  return issues;
}

async function getJiraIssue(keyOrId, fields = []) {
  return jiraGET(`/rest/api/3/issue/${encodeURIComponent(keyOrId)}`, {
    fields: fields.length ? fields.join(",") : undefined,
  });
}

function jiraIssueUrl(key) {
  return `${config.jira.siteUrl}/browse/${key}`;
}

async function main() {
  const args = process.argv.slice(2);
  const forceReset = args.includes("--reset") || args.includes("-r");

  if (forceReset) {
    console.log("🔄 Reseteando credenciales...\n");
  }

  config = await setupCredentials(forceReset);

  console.log("\n🔎 Cargando proyectos de Jira...");
  const jiraProjects = await listJiraProjects();

  const jiraProjectKey = await selectWithEsc({
    message: "Selecciona el proyecto de Jira:",
    pageSize: 15,
    choices: jiraProjects.map((p) => ({
      name: `${p.name} (${p.key})`,
      value: p.key,
    })),
  });

  if (jiraProjectKey === EXIT_SYMBOL) {
    console.log("\n👋 ¡Hasta luego!");
    return;
  }

  const onlyOpen = await confirm({
    message: "¿Solo historias NO finalizadas? (filtra Done/Closed)",
    default: true,
  });

  const baseJql =
    `project = "${jiraProjectKey}" AND issuetype = Story` +
    (onlyOpen ? ` AND statusCategory != Done` : "") +
    ` ORDER BY updated DESC`;

  const jqlOverride = await input({
    message: "JQL (ENTER para usar el por defecto). Si pones uno, reemplaza el filtro:",
    default: baseJql,
  });

  console.log("🔎 Buscando historias en Jira...");
  const stories = await jiraSearchIssues(jqlOverride, [
    "summary",
    "description",
    "subtasks",
    "priority",
    "labels",
    "status",
  ]);

  if (!stories.length) {
    console.log("No he encontrado historias con ese filtro.");
    process.exit(0);
  }

  let selectedStoryKeys = [];

  while (selectedStoryKeys.length === 0) {
    const filterText = await input({
      message: "Filtrar historias (ENTER para ver todas):",
      default: "",
    });

    const filteredStories = filterText.trim()
      ? stories.filter((s) => {
          const text = `${s.key} ${s.fields?.summary ?? ""}`.toLowerCase();
          return text.includes(filterText.toLowerCase());
        })
      : stories;

    if (filteredStories.length === 0) {
      console.log(`No hay historias que coincidan con "${filterText}". Intenta de nuevo.`);
      continue;
    }

    console.log(`📋 ${filteredStories.length} historias encontradas:`);

    selectedStoryKeys = await checkbox({
      message: "Selecciona las historias a migrar (espacio para marcar):",
      pageSize: 15,
      choices: filteredStories.map((i) => ({
        name: `${i.key} — ${i.fields?.summary ?? ""}`,
        value: i.key,
      })),
    });

    if (selectedStoryKeys.length === 0) {
      const retry = await confirm({
        message: "No seleccionaste ninguna. ¿Quieres filtrar de nuevo?",
        default: true,
      });
      if (!retry) {
        console.log("Saliendo sin migrar.");
        process.exit(0);
      }
    }
  }

  console.log("🔌 Conectando a Linear...");
  const linear = new LinearClient({ accessToken: config.linear.accessToken });

  const me = await linear.viewer;
  const teams = await me.teams();
  const teamNodes = teams.nodes;

  const linearTeamId = await selectWithEsc({
    message: "Selecciona el Team de Linear:",
    pageSize: 12,
    choices: teamNodes.map((t) => ({ name: t.name, value: t.id })),
  });

  if (linearTeamId === EXIT_SYMBOL) {
    console.log("\n👋 ¡Hasta luego!");
    return;
  }

  const linearTeam = teamNodes.find((t) => t.id === linearTeamId);

  const projectsConn = await linear.projects({
    first: 250,
    filter: {
      // proyectos de todo el workspace; si queréis “solo del team” habría que filtrar de otra manera
      // (Linear permite issues sin project, así que lo dejo opcional)
    },
  });

  // Obtener nombres de las historias seleccionadas para sugerirlos como proyectos
  const selectedStoryNames = selectedStoryKeys.map((key) => {
    const story = stories.find((s) => s.key === key);
    return story?.fields?.summary ?? key;
  });

  const projectChoices = [
    { name: "(Sin Project)", value: { type: "none" } },
    { name: "➕ Crear proyecto con nombre personalizado...", value: { type: "create_custom" } },
    ...selectedStoryNames.map((name) => ({
      name: `➕ Crear proyecto: "${name}"`,
      value: { type: "create_from_story", name },
    })),
    ...projectsConn.nodes
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => ({ name: p.name, value: { type: "existing", id: p.id } })),
  ];

  const projectChoice = await selectWithEsc({
    message: "Selecciona el Project de Linear:",
    pageSize: 15,
    choices: projectChoices,
  });

  if (projectChoice === EXIT_SYMBOL) {
    console.log("\n👋 ¡Hasta luego!");
    return;
  }

  let linearProjectId = null;

  if (projectChoice.type === "existing") {
    linearProjectId = projectChoice.id;
  } else if (projectChoice.type === "create_custom") {
    const newProjectName = await input({
      message: "Nombre del nuevo proyecto:",
    });
    if (newProjectName.trim()) {
      console.log(`🆕 Creando proyecto "${newProjectName}"...`);
      const createProject = await linear.createProject({
        name: newProjectName.trim(),
        teamIds: [linearTeamId],
      });
      if (createProject.success) {
        linearProjectId = (await createProject.project).id;
        console.log(`✅ Proyecto creado`);
      } else {
        console.log(`⚠️ No se pudo crear el proyecto, continuando sin proyecto`);
      }
    }
  } else if (projectChoice.type === "create_from_story") {
    console.log(`🆕 Creando proyecto "${projectChoice.name}"...`);
    const createProject = await linear.createProject({
      name: projectChoice.name,
      teamIds: [linearTeamId],
    });
    if (createProject.success) {
      linearProjectId = (await createProject.project).id;
      console.log(`✅ Proyecto creado`);
    } else {
      console.log(`⚠️ No se pudo crear el proyecto, continuando sin proyecto`);
    }
  }

  console.log("🚚 Migrando a Linear...");

  const jiraToLinearId = new Map(); // Jira key -> Linear issue id

  for (const key of selectedStoryKeys) {
    const story = stories.find((s) => s.key === key);
    const summary = story?.fields?.summary ?? key;

    // Trae detalles completos (por si el search no trae todo bien en vuestra instancia)
    const full = await getJiraIssue(key, [
      "summary",
      "description",
      "subtasks",
      "priority",
      "labels",
      "status",
    ]);

    const mdDescription = adfToMarkdown(full.fields?.description);
    const header =
      `**Migrado desde Jira:** ${key}\n` +
      `${jiraIssueUrl(key)}\n\n` +
      `---\n\n`;

    const createRes = await linear.createIssue({
      title: summary,
      description: header + (mdDescription || "_(Sin descripción)_"),
      teamId: linearTeamId,
      projectId: linearProjectId ?? undefined,
    });

    if (!createRes.success) {
      console.error(`❌ Fallo creando la historia ${key} en Linear`);
      continue;
    }

    const linearIssue = await createRes.issue;
    jiraToLinearId.set(key, linearIssue.id);

    console.log(`✅ ${key} -> Linear (${linearIssue.identifier})`);

    // Subtasks -> sub-issues
    const subtasks = full.fields?.subtasks || [];
    for (const st of subtasks) {
      const stKey = st.key;
      const stFull = await getJiraIssue(stKey, ["summary", "description"]);

      const stTitle = stFull.fields?.summary ?? stKey;
      const stDesc = adfToMarkdown(stFull.fields?.description);

      const stHeader =
        `**Subtarea migrada desde Jira:** ${stKey}\n` +
        `${jiraIssueUrl(stKey)}\n\n` +
        `**Parent (Jira):** ${key}\n\n` +
        `---\n\n`;

      // parentId está soportado por Linear para sub-issues :contentReference[oaicite:4]{index=4}
      const stCreateRes = await linear.createIssue({
        title: stTitle,
        description: stHeader + (stDesc || "_(Sin descripción)_"),
        teamId: linearTeamId,
        projectId: linearProjectId ?? undefined,
        parentId: linearIssue.id,
      });

      if (stCreateRes.success) {
        const stIssue = await stCreateRes.issue;
        console.log(`   ↳ ✅ ${stKey} -> ${stIssue.identifier}`);
      } else {
        console.log(`   ↳ ❌ Fallo creando sub-issue para ${stKey}`);
      }
    }
  }

  console.log("\n🎉 Hecho. Historias migradas:");
  for (const key of selectedStoryKeys) {
    const id = jiraToLinearId.get(key);
    console.log(`- ${key} -> ${id ? "OK" : "FALLÓ"}`);
  }

  // Preguntar si quiere continuar
  const continueChoice = await selectWithEsc({
    message: "¿Qué quieres hacer ahora?",
    choices: [
      { name: "Migrar más historias del mismo proyecto", value: "same" },
      { name: "Cambiar de proyecto", value: "change" },
    ],
  });

  if (continueChoice === EXIT_SYMBOL) {
    console.log("\n👋 ¡Hasta luego!");
    return;
  }

  if (continueChoice === "change") {
    return main(); // Reinicia todo el flujo
  }

  // continueChoice === "same" - volver a buscar historias del mismo proyecto
  return continueFromSearch(jqlOverride, linearTeamId, linearProjectId, linear);
}

async function continueFromSearch(jql, linearTeamId, linearProjectId, linear) {
  console.log("\n🔎 Buscando historias en Jira...");
  const stories = await jiraSearchIssues(jql, [
    "summary",
    "description",
    "subtasks",
    "priority",
    "labels",
    "status",
  ]);

  if (!stories.length) {
    console.log("No hay más historias con ese filtro.");
    const retry = await confirm({
      message: "¿Quieres cambiar de proyecto?",
      default: true,
    });
    if (retry) return main();
    return;
  }

  let selectedStoryKeys = [];

  while (selectedStoryKeys.length === 0) {
    const filterText = await input({
      message: "Filtrar historias (ENTER para ver todas):",
      default: "",
    });

    const filteredStories = filterText.trim()
      ? stories.filter((s) => {
          const text = `${s.key} ${s.fields?.summary ?? ""}`.toLowerCase();
          return text.includes(filterText.toLowerCase());
        })
      : stories;

    if (filteredStories.length === 0) {
      console.log(`No hay historias que coincidan con "${filterText}". Intenta de nuevo.`);
      continue;
    }

    console.log(`📋 ${filteredStories.length} historias encontradas:`);

    selectedStoryKeys = await checkbox({
      message: "Selecciona las historias a migrar (espacio para marcar):",
      pageSize: 15,
      choices: filteredStories.map((i) => ({
        name: `${i.key} — ${i.fields?.summary ?? ""}`,
        value: i.key,
      })),
    });

    if (selectedStoryKeys.length === 0) {
      const retry = await confirm({
        message: "No seleccionaste ninguna. ¿Quieres filtrar de nuevo?",
        default: true,
      });
      if (!retry) return;
    }
  }

  console.log("🚚 Migrando a Linear...");

  const jiraToLinearId = new Map();

  for (const key of selectedStoryKeys) {
    const story = stories.find((s) => s.key === key);
    const summary = story?.fields?.summary ?? key;

    const full = await getJiraIssue(key, [
      "summary",
      "description",
      "subtasks",
      "priority",
      "labels",
      "status",
    ]);

    const mdDescription = adfToMarkdown(full.fields?.description);
    const header =
      `**Migrado desde Jira:** ${key}\n` +
      `${jiraIssueUrl(key)}\n\n` +
      `---\n\n`;

    const createRes = await linear.createIssue({
      title: summary,
      description: header + (mdDescription || "_(Sin descripción)_"),
      teamId: linearTeamId,
      projectId: linearProjectId ?? undefined,
    });

    if (!createRes.success) {
      console.error(`❌ Fallo creando la historia ${key} en Linear`);
      continue;
    }

    const linearIssue = await createRes.issue;
    jiraToLinearId.set(key, linearIssue.id);

    console.log(`✅ ${key} -> Linear (${linearIssue.identifier})`);

    const subtasks = full.fields?.subtasks || [];
    for (const st of subtasks) {
      const stKey = st.key;
      const stFull = await getJiraIssue(stKey, ["summary", "description"]);

      const stTitle = stFull.fields?.summary ?? stKey;
      const stDesc = adfToMarkdown(stFull.fields?.description);

      const stHeader =
        `**Subtarea migrada desde Jira:** ${stKey}\n` +
        `${jiraIssueUrl(stKey)}\n\n` +
        `**Parent (Jira):** ${key}\n\n` +
        `---\n\n`;

      const stCreateRes = await linear.createIssue({
        title: stTitle,
        description: stHeader + (stDesc || "_(Sin descripción)_"),
        teamId: linearTeamId,
        projectId: linearProjectId ?? undefined,
        parentId: linearIssue.id,
      });

      if (stCreateRes.success) {
        const stIssue = await stCreateRes.issue;
        console.log(`   ↳ ✅ ${stKey} -> ${stIssue.identifier}`);
      } else {
        console.log(`   ↳ ❌ Fallo creando sub-issue para ${stKey}`);
      }
    }
  }

  console.log("\n🎉 Hecho. Historias migradas:");
  for (const key of selectedStoryKeys) {
    const id = jiraToLinearId.get(key);
    console.log(`- ${key} -> ${id ? "OK" : "FALLÓ"}`);
  }

  const continueChoice = await selectWithEsc({
    message: "¿Qué quieres hacer ahora?",
    choices: [
      { name: "Migrar más historias del mismo proyecto", value: "same" },
      { name: "Cambiar de proyecto", value: "change" },
    ],
  });

  if (continueChoice === EXIT_SYMBOL) {
    console.log("\n👋 ¡Hasta luego!");
    return;
  }

  if (continueChoice === "change") {
    return main();
  }

  return continueFromSearch(jql, linearTeamId, linearProjectId, linear);
}

// Only run main when executed directly, not when imported
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((e) => {
    console.error("\n💥 Error:", e?.message || e);
    process.exit(1);
  });
}
