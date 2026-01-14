#!/usr/bin/env node
import { select, checkbox, confirm, input, password } from "@inquirer/prompts";
import { fetch } from "undici";
import { LinearClient } from "@linear/sdk";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(homedir(), ".jira-to-linear.json");

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

async function setupCredentials() {
  const config = loadConfig();

  console.log("🔐 Configuración de credenciales\n");

  // Jira
  if (config.jira?.baseUrl && config.jira?.email && config.jira?.apiToken) {
    const useExisting = await confirm({
      message: `¿Usar cuenta de Jira guardada? (${config.jira.email} en ${config.jira.baseUrl})`,
      default: true,
    });
    if (!useExisting) {
      delete config.jira;
    }
  }

  if (!config.jira) {
    console.log("\n📋 Configura tu cuenta de Jira:");
    const baseUrl = await input({
      message: "URL de Jira (ej: https://tu-empresa.atlassian.net):",
      validate: (v) => v.startsWith("http") || "Debe empezar con http:// o https://",
    });
    const email = await input({
      message: "Email de Jira:",
      validate: (v) => v.includes("@") || "Introduce un email válido",
    });
    const apiToken = await password({
      message: "API Token de Jira (créalo en https://id.atlassian.com/manage-profile/security/api-tokens):",
      mask: "*",
    });

    config.jira = {
      baseUrl: baseUrl.replace(/\/$/, ""),
      email,
      apiToken,
    };
  }

  // Linear
  if (config.linear?.apiKey) {
    const useExisting = await confirm({
      message: "¿Usar cuenta de Linear guardada?",
      default: true,
    });
    if (!useExisting) {
      delete config.linear;
    }
  }

  if (!config.linear) {
    console.log("\n📐 Configura tu cuenta de Linear:");
    const apiKey = await password({
      message: "API Key de Linear (créala en Linear > Settings > API):",
      mask: "*",
    });

    config.linear = { apiKey };
  }

  // Validar credenciales
  console.log("\n🔍 Verificando credenciales...");

  // Test Jira
  const jiraAuth = "Basic " + Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64");
  try {
    const res = await fetch(`${config.jira.baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: jiraAuth, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const me = await res.json();
    console.log(`✅ Jira: conectado como ${me.displayName}`);
  } catch (e) {
    console.error("❌ Error conectando a Jira:", e.message);
    delete config.jira;
    return setupCredentials();
  }

  // Test Linear
  try {
    const linear = new LinearClient({ apiKey: config.linear.apiKey });
    const viewer = await linear.viewer;
    console.log(`✅ Linear: conectado como ${viewer.name}`);
  } catch (e) {
    console.error("❌ Error conectando a Linear:", e.message);
    delete config.linear;
    return setupCredentials();
  }

  // Guardar config
  const save = await confirm({
    message: "¿Guardar credenciales para futuras ejecuciones?",
    default: true,
  });
  if (save) {
    saveConfig(config);
    console.log(`💾 Guardado en ${CONFIG_PATH}\n`);
  }

  return config;
}

let config;

async function jiraGET(path, params = {}) {
  const url = new URL(`${config.jira.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const jiraAuth = "Basic " + Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: jiraAuth,
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
function adfToMarkdown(adf) {
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
  return `${config.jira.baseUrl}/browse/${key}`;
}

async function main() {
  config = await setupCredentials();

  console.log("\n🔎 Cargando proyectos de Jira...");
  const jiraProjects = await listJiraProjects();

  const jiraProjectKey = await select({
    message: "Selecciona el proyecto de Jira:",
    pageSize: 15,
    choices: jiraProjects.map((p) => ({
      name: `${p.name} (${p.key})`,
      value: p.key,
    })),
  });

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
  const linear = new LinearClient({ apiKey: config.linear.apiKey });

  const me = await linear.viewer;
  const teams = await me.teams();
  const teamNodes = teams.nodes;

  const linearTeamId = await select({
    message: "Selecciona el Team de Linear donde crear las issues:",
    pageSize: 12,
    choices: teamNodes.map((t) => ({ name: t.name, value: t.id })),
  });

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

  const projectChoice = await select({
    message: "Selecciona el Project de Linear (opcional):",
    pageSize: 15,
    choices: projectChoices,
  });

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
}

main().catch((e) => {
  console.error("\n💥 Error:", e?.message || e);
  process.exit(1);
});
