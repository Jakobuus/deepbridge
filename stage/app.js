"use strict";

const $ = (selector, parent = document) => parent.querySelector(selector);
const API = (new URLSearchParams(location.search).get("api") || "http://localhost:8000").replace(/\/+$/, "");
const stages = ["found", "path_checked", "draft", "approved", "intro_asked", "intro_made", "pilot"];
const stageLabels = ["Found", "Path checked", "Draft", "Approved", "Intro asked", "Intro made", "Pilot"];
const demoId = "person:openalex:A5102978866";
const state = {
  view: "signup", founder: null, selection: "", graphMode: false, graphCleanup: null,
  research: new Map(), drafts: new Map(), evidence: new Map(), interview: null, muted: true
};

function element(tag, { text, className, ...attributes } = {}, ...children) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children.flat().filter(child => child != null && typeof child !== "boolean"));
  return node;
}

const text = (tag, value, className) => element(tag, { text: value, className });
const stack = (...children) => element("div", { className: "stack" }, ...children);
const panel = (...children) => element("section", { className: "panel stack" }, ...children);
const caption = value => text("p", value, "caption");
const titleCase = value => value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const route = (collection, id) => `/${collection}/${encodeURIComponent(id)}`;

function button(label, action, className) {
  const node = element("button", { text: label, type: "button", className });
  node.addEventListener("click", action);
  return node;
}

async function request(path, { method = "GET", body, founder = null } = {}) {
  const suffix = founder ? `?founder_id=${encodeURIComponent(founder)}` : "";
  let response;
  try {
    response = await fetch(API + path + suffix, {
      method,
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(190000)
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API}. Check the API URL and allow ${location.origin} in CORS.`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail :
      Array.isArray(payload?.detail) ? payload.detail.map(issue => issue.msg).join(". ") : response.statusText;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  if (payload === null) throw new Error("The API returned an invalid payload.");
  return payload;
}

function setMessage(selector, value) {
  const node = $(selector);
  node.textContent = value;
  node.hidden = !value;
}

function showError(error) {
  const hint = {
    402: "No credits available for this draft.",
    409: "Conflict."
  }[error.status];
  setMessage("#error", [hint, error.status && `HTTP ${error.status}.`, error.message].filter(Boolean).join(" "));
}

async function run(button, action) {
  button.disabled = true;
  setMessage("#error", "");
  setMessage("#status", "");
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

function getResearch(path, founder = state.founder?.id) {
  const key = `${founder || ""}|${path}`;
  if (!state.research.has(key)) {
    state.research.set(key, request(path, { founder }).catch(error => {
      state.research.delete(key);
      throw error;
    }));
  }
  return state.research.get(key);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function link(label, url) {
  return element("a", { text: label, href: url, target: "_blank", rel: "noopener noreferrer" });
}

async function getEvidence(ids = []) {
  return (await Promise.all([...new Set(ids)].map(id => {
    if (!state.evidence.has(id)) {
      state.evidence.set(id, request(route("evidence", id)).catch(() => {
        state.evidence.delete(id);
        return null;
      }));
    }
    return state.evidence.get(id);
  }))).filter(item => item && safeUrl(item.source_url));
}

function chips(evidence, showQuote = true) {
  return element("div", { className: "chips" }, evidence.map((item, index) => {
    const label = `${titleCase(item.kind)}${item.source_date ? " · " + item.source_date : ""}${evidence.length > 1 ? " · " + (index + 1) : ""}`;
    const node = link(label, safeUrl(item.source_url));
    if (showQuote) node.title = item.quote;
    return node;
  }));
}

function cited(evidence, ...details) {
  if (!evidence.length) return null;
  return element("div", { className: "item" }, ...details, chips(evidence));
}

function openDrawer(title, ...content) {
  const drawer = $("#drawer");
  $("#drawer-title").textContent = title;
  $("#drawer-content").replaceChildren(...content);
  if (!drawer.open) drawer.showModal();
  return $("#drawer-content");
}

async function openEdge(edge) {
  const loading = caption("Loading source…");
  const content = openDrawer("Publication evidence", loading);
  const evidence = await getEvidence(edge.evidence_ids);
  if (content.firstElementChild !== loading) return;
  content.replaceChildren(...(evidence.length ? [
    text("h3", edge.label),
    caption(`Identity check · ${titleCase(edge.name_check)}`),
    ...evidence.map(item => stack(
      caption(`Source date: ${item.source_date || "See source"} · Observed ${item.observed_at.slice(0, 10)}`),
      text("blockquote", item.quote),
      link("Open source", safeUrl(item.source_url))
    ))
  ] : [caption("Source unavailable for this edge.")]));
}

async function openContact(personId, label) {
  const loading = caption("Resolving contact…");
  const content = openDrawer("Contact", loading);
  try {
    const contact = await request(route("contacts", personId), { founder: state.founder?.id });
    const evidence = await getEvidence(contact.evidence_ids);
    const datedRole = [contact.current_role, contact.current_org].filter(Boolean).join(" · ");
    const profiles = contact.profiles.filter(profile => safeUrl(profile.url));
    const mossRole = contact.source === "moss_task" ||
      (contact.source === "cache" && evidence.some(item => item.id.startsWith("evidence:moss:")));
    if (content.firstElementChild !== loading) return;
    content.replaceChildren(
      text("h3", label),
      caption(`Contact source · ${({ moss_task: "Moss Tasks", hunter: "Hunter", pattern: "Email pattern", cache: "Cached contact" })[contact.source]}`),
      ...(mossRole && contact.current_role && contact.current_asof && evidence.length ? [
        text("span", "Moss-verified role", "pill")
      ] : []),
      ...(datedRole && contact.current_asof && evidence.length ? [
        text("p", datedRole), caption(`As of ${contact.current_asof}`)
      ] : []),
      caption(contact.email ? `Masked email · •••••@••••• · ${titleCase(contact.email_status)}` : "Email unavailable"),
      ...(evidence.length ? [chips(evidence, false)] : []),
      ...(profiles.length ? [element("div", { className: "chips" }, profiles.map(profile => link(titleCase(profile.kind), safeUrl(profile.url))))] : [])
    );
  } catch (error) {
    if (content.firstElementChild === loading) content.replaceChildren(caption(error.message));
  }
}

async function refreshCredits() {
  try {
    const credits = await request("/credits");
    $("#credits").textContent = `${credits.balance} ${credits.balance === 1 ? "credit" : "credits"}`;
    $("#credits").title = `Credit source: ${credits.source}`;
  } catch {
    $("#credits").textContent = "Credits unavailable";
  }
}

async function checkConnection() {
  try {
    const health = await request("/health");
    $(".rail-foot").dataset.online = "true";
    $("#connection").textContent = health.data === "cache" ? "API online · cached demo" : "API online";
  } catch (error) {
    $("#connection").textContent = "API unavailable";
    $("#connection").title = error.message;
  }
}

async function intake(body) {
  setMessage("#status", "Looking up founder…");
  try {
    const founder = await request("/intake", { method: "POST", body });
    const evidence = await getEvidence(founder.evidence_ids);
    state.founder = founder;
    state.selection = "";
    state.research.clear();
    state.drafts.clear();
    $("#case-label").textContent = founder.company || founder.name;
    const card = $("#founder-card");
    card.replaceChildren(
      text("p", founder.id === demoId ? "Cached research replay" : "Research profile", "eyebrow"),
      text("h2", founder.name),
      ...((founder.company || founder.summary) && evidence.length ? [
        ...(founder.company ? [text("h3", founder.company)] : []),
        text("p", founder.summary),
        ...(founder.topics.length ? [caption(founder.topics.join(" · "))] : []),
        chips(evidence)
      ] : [caption("Citations are unavailable for this profile.")]),
      element("div", { className: "actions" }, button("View ICP & buyers", () => navigate("icp"), "primary"))
    );
    card.hidden = false;
  } finally {
    setMessage("#status", "");
  }
}

function intakeBody(form) {
  const values = new FormData(form);
  const field = name => values.get(name).trim();
  return {
    name: field("name"), expertise: field("expertise"), customer_persona: field("customer_persona"),
    paper_links: field("paper_links").split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    startup_url: field("startup_url") || null, interview_transcript: field("interview_transcript") || null
  };
}

function formSubmit(form, action) {
  form.addEventListener("submit", event => {
    event.preventDefault();
    run(event.submitter || $("button[type=submit]", form), () => action(form));
  });
}

formSubmit($("#intake"), form => intake(intakeBody(form)));
formSubmit($("#lookup"), form => {
  const query = new FormData(form).get("query").trim();
  if (!query) throw new Error("Enter a founder name or DOI.");
  return intake({ query });
});
$("#load-demo").addEventListener("click", event => run(event.currentTarget, () => intake({ query: "Lightmatter" })));

async function renderIcp(target) {
  const [profile, buyers] = await Promise.allSettled([getResearch("/icp"), getResearch("/buyers")]);
  const sections = [];
  if (profile.status === "fulfilled") {
    const groups = [
      ["Buyer roles", profile.value.buyer_roles, "title"],
      ["Industries", profile.value.industries, "name"],
      ["Needs", profile.value.needs, "text"],
      ["Expansion segments", profile.value.expansion_segments, "name"]
    ];
    const groupPanels = await Promise.all(groups.map(async ([label, items, key]) => {
      const rows = (await Promise.all(items.map(async item => cited(
        await getEvidence(item.evidence_ids), text("h3", item[key]), item.why && text("p", item.why)
      )))).filter(Boolean);
      return panel(text("h3", label), ...(rows.length ? rows : [caption("No cited entries.")]));
    }));
    sections.push(text("h2", "Buyer hypotheses"), element("div", { className: "icp-grid" }, groupPanels));
  } else {
    sections.push(panel(text("h2", "Buyer hypotheses"), caption(profile.reason.message)));
  }
  if (buyers.status === "fulfilled") {
    const { orgs, signals } = buyers.value;
    const items = await Promise.all(orgs.map(async org => {
      const orgSignals = signals.filter(signal => signal.org_id === org.id);
      const rows = (await Promise.all(orgSignals.map(async signal => cited(
        await getEvidence(signal.evidence_ids),
        text("h3", signal.title),
        caption(`${titleCase(signal.type)}${signal.date ? " · " + signal.date : ""}`)
      )))).filter(Boolean);
      return panel(
        element("div", { className: "section-heading" }, text("h3", org.name),
          org.buyer_score !== null && text("span", `${org.buyer_score}/100`, "pill secondary")),
        ...(rows.length ? rows : [caption("No cited buying signals.")])
      );
    }));
    sections.push(text("h2", "Potential buyers"), caption("Research replay · Scores are ranking estimates."),
      items.length ? element("div", { className: "buyer-list" }, items) : caption("No potential buyers returned."));
  } else {
    sections.push(panel(text("h2", "Potential buyers"), caption(buyers.reason.message)));
  }
  target.replaceChildren(...sections);
}

async function loadNetwork() {
  const [graph, paths] = await Promise.all([getResearch("/graph"), getResearch("/paths")]);
  for (const item of graph.evidence) state.evidence.set(item.id, Promise.resolve(item));
  const people = new Map(graph.people.map(item => [item.id, item]));
  const orgs = new Map(graph.orgs.map(item => [item.id, item]));
  const edges = new Map(graph.edges.map(item => [item.id, item]));
  const name = id => people.get(id)?.name || orgs.get(id)?.name || (id === state.founder?.id ? state.founder.name : "Unknown");
  const byId = new Map(paths.map(path => [path.id, path]));
  return { paths, byId, people, orgs, edges, name };
}

function pathName(network, path) {
  return `${network.name(path.bridge_id)} → ${network.name(path.buyer_org_id)}`;
}

function pathPicker(network, selected, change) {
  const select = element("select", { id: "path-select" }, network.paths.map(path =>
    element("option", { value: path.id, text: pathName(network, path) })));
  select.value = selected.id;
  select.addEventListener("change", () => change(network.byId.get(select.value)));
  return element("label", {}, "Lead path", select);
}

function table(headers, rows) {
  return element("div", { className: "table-scroll" }, element("table", {},
    element("thead", {}, element("tr", {}, headers.map(label => text("th", label)))),
    element("tbody", {}, rows)
  ));
}

function pathTable(network, selected, choose) {
  return panel(text("h2", "Path ranking"),
    table(["Bridge", "Buyer", "Path kind", "Score", "Inspect"], network.paths.map(path =>
      element("tr", { "data-selected": path.id === selected.id },
        text("td", network.name(path.bridge_id)),
        text("td", network.name(path.buyer_org_id)),
        text("td", titleCase(path.kind)),
        text("td", `${path.score}/100`),
        element("td", {}, button(path.id === selected.id ? "Selected" : "Select", () => choose(path)))
      )))
  );
}

function pathActions(network, path, showWeakest) {
  const weak = network.edges.get(path.weakest_edge_id);
  return element("div", { className: "actions" },
    showWeakest && weak && button("Weakest hop: " + weak.label, () => openEdge(weak)),
    path.bridge_id && button("Bridge contact", () => openContact(path.bridge_id, network.name(path.bridge_id))),
    path.buyer_person_id && path.buyer_person_id !== path.bridge_id &&
      button("Buyer contact", () => openContact(path.buyer_person_id, network.name(path.buyer_person_id))),
    button("Open drafts", () => navigate("draft"), "primary")
  );
}

async function renderLeads(target) {
  const network = await loadNetwork();
  if (state.view !== "leads" || !target.isConnected) return;
  if (!network.paths.length) {
    target.replaceChildren(panel(caption("No paths returned for this founder.")));
    return;
  }
  const show = (selected, focusId) => {
    state.graphCleanup?.();
    state.graphCleanup = null;
    state.selection = selected.id;
    const choose = path => show(path, "#path-select");
    const toggle = (label, mode) => {
      const toggleButton = button(label, () => {
        state.graphMode = mode;
        show(selected, mode ? "#graph-mode" : "#table-mode");
      }, "toggle");
      toggleButton.id = mode ? "graph-mode" : "table-mode";
      toggleButton.setAttribute("aria-pressed", state.graphMode === mode);
      return toggleButton;
    };
    const summary = caption(state.founder?.id === demoId ? "Cached research replay · Scores are ranking estimates." :
      "Research graph · Scores are ranking estimates.");
    const detail = state.graphMode ? null : panel(
      element("div", { className: "section-heading" }, text("h2", pathName(network, selected)),
        text("span", titleCase(selected.kind), "pill secondary")),
      pathActions(network, selected, true)
    );
    target.replaceChildren(stack(
      element("div", { className: "toolbar" }, pathPicker(network, selected, choose),
        element("div", { className: "actions" }, toggle("Table", false), toggle("Graph", true))),
      state.graphMode ? element("div", { className: "section-heading" }, summary, pathActions(network, selected, false)) : summary,
      state.graphMode ? spaceGraph(network, selected) : pathTable(network, selected, choose),
      detail
    ));
    if (focusId) $(focusId, target)?.focus();
  };
  show(network.byId.get(state.selection) || network.paths[0]);
}

function spaceGraph(network, selected) {
  const paths = [selected, ...network.paths.filter(path => path.id !== selected.id).slice(0, 4)];
  const active = new Set(selected.hops);
  const edges = [...new Set(paths.flatMap(path => path.hops))].map(id => network.edges.get(id)).filter(Boolean);
  const nodeIds = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))];
  const nodes = nodeIds.map((id, index) => ({
    id, x: 0, y: 0, index,
    role: id === selected.founder_id ? "founder" : network.orgs.has(id) ? "buyer" : "bridge",
    onPath: edges.some(edge => active.has(edge.id) && [edge.from, edge.to].includes(id))
  }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const lines = edges.map(edge => ({ edge, from: byId.get(edge.from), to: byId.get(edge.to) }));
  const canvas = element("canvas", {
    role: "img", "aria-label": "Force layout of the selected research path and neighboring paths"
  });
  const frame = element("div", { className: "graph-frame" }, canvas,
    element("div", { className: "graph-controls" },
      caption("Highlighted path · Founder → Bridge → Buyer organization"),
      element("div", { className: "actions" }, lines.filter(line => active.has(line.edge.id))
        .map(({ edge }) => button(edge.label, () => openEdge(edge), "edge-hit")))
    )
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) return frame;
  const styles = getComputedStyle(document.documentElement);
  const token = name => styles.getPropertyValue(name).trim();
  const palette = Object.fromEntries(["bg", "ring", "edge", "text", "muted", "founder", "bridge", "buyer", "star", "glow"]
    .map(name => [name, token("--space-" + name)]));
  let width = 0;

  function draw() {
    width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    positionNodes(nodes, lines, selected, width, height);

    for (let index = 0; index < 125; index++) {
      const x = (index * 137.508 % 101) / 101 * width;
      const y = (index * 71.323 % 103) / 103 * height;
      ctx.globalAlpha = index % 5 === 0 ? .8 : .32;
      ctx.fillStyle = palette.star;
      ctx.fillRect(x, y, index % 11 === 0 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.ring;
    ctx.lineWidth = 1;
    for (const fraction of [.18, .29, .41]) {
      ctx.beginPath();
      ctx.ellipse(width * .5, height * .5, width * fraction, height * fraction, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const { edge, from, to } of [...lines].sort((a, b) => Number(active.has(a.edge.id)) - Number(active.has(b.edge.id)))) {
      ctx.strokeStyle = active.has(edge.id) ? palette.buyer : palette.edge;
      ctx.lineWidth = active.has(edge.id) ? 2.4 : 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.font = `600 ${token("--type-xs")} ${token("--font")}`;
    ctx.strokeStyle = palette.bg;
    ctx.fillStyle = palette.buyer;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    for (const { edge, from, to } of lines.filter(line => active.has(line.edge.id))) {
      const x = (from.x + to.x) * .5;
      const y = (from.y + to.y) * .5 - 10;
      ctx.strokeText(edge.label, x, y, width * .27);
      ctx.fillText(edge.label, x, y, width * .27);
    }
    for (const node of nodes) {
      const radius = node.role === "founder" ? 8 : 5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
      ctx.strokeStyle = node.onPath ? palette.glow : palette.ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.onPath ? palette[node.role] : palette.edge;
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = node.onPath ? palette.text : palette.muted;
      ctx.font = `${node.onPath ? 720 : 500} ${token(node.onPath ? "--type-base" : "--type-xs")} ${token("--font")}`;
      ctx.fillText(network.name(node.id), node.x, node.y + 25, width * .27);
    }
    ctx.fillStyle = palette.muted;
    ctx.font = `600 ${token("--type-xs")} ${token("--mono")}`;
    ctx.textAlign = "center";
    for (const [label, x] of [["FOUNDER", .16], ["BRIDGE", .5], ["BUYER ORGANIZATION", .84]]) {
      ctx.fillText(label, width * x, 27);
    }
  }

  function edgeAt(event) {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let closest = null;
    let distance = 9;
    for (const { edge, from, to } of lines) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const offset = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / (dx * dx + dy * dy)));
      const gap = Math.hypot(x - from.x - dx * offset, y - from.y - dy * offset);
      if (gap < distance) {
        closest = edge;
        distance = gap;
      }
    }
    return closest;
  }

  canvas.addEventListener("pointermove", event => { canvas.style.cursor = edgeAt(event) ? "pointer" : ""; });
  canvas.addEventListener("click", event => {
    const edge = edgeAt(event);
    if (edge) openEdge(edge);
  });
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  state.graphCleanup = () => observer.disconnect();
  return frame;
}

function positionNodes(nodes, lines, selected, width, height) {
  const columns = { founder: .16, bridge: .5, buyer: .84 };
  const active = nodes.filter(node => node.onPath);
  const elided = nodes.filter(node => !node.onPath);
  for (const node of nodes) {
    const rolePeers = (node.onPath ? active : elided).filter(peer => peer.role === node.role);
    const offset = rolePeers.indexOf(node);
    const centered = node.id === selected.bridge_id || node.id === selected.buyer_org_id || node.role === "founder";
    node.anchorX = width * columns[node.role];
    node.anchorY = height * (centered ? .49 : offset % 2 === 0 ? .23 + Math.floor(offset / 2) * .08 : .77 - Math.floor(offset / 2) * .08);
    node.x = node.anchorX + (node.index % 3 - 1) * width * .025;
    node.y = node.anchorY;
  }

  for (let iteration = 0; iteration < 80; iteration++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (const b of nodes.slice(i + 1)) {
        const dx = b.x - a.x || .1;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const push = Math.min(7, 4500 / (distance * distance));
        a.x -= dx / distance * push;
        a.y -= dy / distance * push;
        b.x += dx / distance * push;
        b.y += dy / distance * push;
      }
    }
    for (const { from, to } of lines) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const pull = (distance - width * .31) * .015;
      from.x += dx / distance * pull;
      from.y += dy / distance * pull;
      to.x -= dx / distance * pull;
      to.y -= dy / distance * pull;
    }
    for (const node of nodes) {
      node.x += (node.anchorX - node.x) * .15;
      node.y += (node.anchorY - node.y) * .12;
    }
  }
}

async function renderDrafts(target) {
  const network = await loadNetwork();
  if (state.view !== "draft" || !target.isConnected) return;
  if (!network.paths.length) {
    target.replaceChildren(panel(caption("Choose a founder with lead paths to draft outreach.")));
    return;
  }
  const pick = (path, focus = false) => {
    state.selection = path.id;
    const drafts = state.drafts.get(path.id);
    const editor = element("div", { className: "editor" });
    let chosenDraft = drafts?.[0]?.id;
    const generate = (label, success) => button(label, event => run(event.currentTarget, async () => {
      try {
        setMessage("#status", "Loading drafts…");
        const next = await request("/drafts", { method: "POST", body: { path_id: path.id }, founder: path.founder_id });
        if (!next.length) throw new Error("The API returned no drafts.");
        state.drafts.set(path.id, next);
        if (state.selection === path.id && state.view === "draft") {
          pick(path);
          setMessage("#status", success);
        }
      } finally {
        await refreshCredits();
        if ($("#status").textContent === "Loading drafts…") setMessage("#status", "");
      }
    }), "primary");
    target.replaceChildren(panel(
      element("div", { className: "toolbar" }, pathPicker(network, path, next => pick(next, true)),
        !drafts && generate("Generate drafts", "Draft ready.")),
      drafts && editor
    ));
    if (focus) $("#path-select", target).focus();
    if (!drafts) return;

    function showEditor() {
      const draft = drafts.find(item => item.id === chosenDraft);
      const picker = element("select", { id: "draft-select" }, drafts.map(item =>
        element("option", { text: titleCase(item.kind), value: item.id })));
      picker.value = chosenDraft;
      picker.addEventListener("change", () => {
        chosenDraft = picker.value;
        showEditor();
        $("#draft-select", editor).focus();
      });
      const subject = element("input", { name: "subject", required: "" });
      const body = element("textarea", { name: "body", rows: "10", required: "" });
      subject.value = draft.subject;
      body.value = draft.body;
      const status = text("span", "", "pill");
      const save = element("button", { type: "submit", text: "Save edits" });
      const evidence = element("div");
      getEvidence(draft.evidence_ids).then(items => evidence.replaceChildren(items.length ?
        chips(items) : caption("Citations unavailable for this draft.")));
      let conflict = false;
      const reload = generate("Reload latest drafts", "Latest drafts loaded. Review the content before approving.");
      reload.hidden = true;
      const decision = (label, value, className) => button(label, async () => {
        if (changed() || conflict || busy) return;
        lockControls();
        setMessage("#error", "");
        setMessage("#status", "");
        try {
          apply(await request("/approve", {
            method: "POST", founder: path.founder_id,
            body: { draft_id: draft.id, content_hash: draft.content_hash, decision: value }
          }));
          setMessage("#status", value === "approve" ? "" : "Draft rejected.");
        } catch (error) {
          if (error.status === 409) {
            conflict = true;
            update();
          }
          showError(error);
        } finally {
          unlockControls();
        }
      }, className);
      const approve = decision("Approve", "approve", "primary");
      const reject = decision("Reject", "reject");
      const form = element("form", { className: "stack" },
        element("div", { className: "section-heading" }, text("h2", "Review draft"), status),
        element("label", {}, "Subject", subject),
        element("label", {}, "Message body", body),
        evidence,
        element("div", { className: "actions" }, save, approve, reject, reload)
      );
      const changed = () => subject.value !== draft.subject || body.value !== draft.body;
      let busy = false;
      function update() {
        const dirty = changed();
        const needsApproval = draft.status === "stale" || (draft.status === "approved" && dirty);
        status.textContent = conflict ? "Draft conflict" : needsApproval ? "Needs re-approval" :
          dirty ? "Unsaved edits" : titleCase(draft.status);
        status.classList.toggle("warning", needsApproval || conflict);
        save.disabled = !dirty || busy;
        approve.disabled = dirty || conflict || busy || draft.status === "approved";
        reject.disabled = dirty || conflict || busy || draft.status === "rejected";
        reload.hidden = !conflict;
      }
      function apply(next) {
        Object.assign(draft, next);
        subject.value = next.subject;
        body.value = next.body;
        update();
      }
      function lockControls() {
        busy = true;
        form.querySelectorAll("button").forEach(control => { control.disabled = true; });
        subject.readOnly = true;
        body.readOnly = true;
      }
      function unlockControls() {
        busy = false;
        reload.disabled = false;
        subject.readOnly = false;
        body.readOnly = false;
        update();
      }
      form.addEventListener("input", update);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!changed() || busy) return;
        lockControls();
        try {
          setMessage("#error", "");
          setMessage("#status", "");
          apply(await request(route("drafts", draft.id), {
            method: "PUT", founder: path.founder_id, body: { subject: subject.value, body: body.value }
          }));
          conflict = false;
          setMessage("#status", "Edits saved.");
        } catch (error) {
          showError(error);
        } finally {
          unlockControls();
        }
      });
      editor.replaceChildren(stack(element("label", {}, "Draft", picker), form));
      update();
    }
    showEditor();
  };
  pick(network.byId.get(state.selection) || network.paths[0]);
}

async function renderPipeline(target) {
  const [network, cards, metrics] = await Promise.all([
    loadNetwork(), request("/pipeline", { founder: state.founder?.id }),
    request("/metrics", { founder: state.founder?.id })
  ]);
  const board = element("div", { className: "kanban" }, stages.map((stage, index) => {
    const matches = cards.filter(card => card.stage === stage);
    return element("section", { className: "lane" },
      element("h3", {}, stageLabels[index], text("span", String(matches.length), "caption")),
      ...matches.map(card => {
        const path = network.byId.get(card.path_id);
        const last = card.history.at(-1);
        return element("article", { className: "pipeline-card" },
          text("strong", path ? network.name(path.buyer_org_id) : card.path_id),
          path && caption(titleCase(path.kind)),
          last && caption(`${last.actor} · ${last.actor_kind}`)
        );
      })
    );
  }));

  const metricRow = values => element("tr", {}, values.map(value => text("td", String(value))));
  target.replaceChildren(
    panel(element("div", { className: "section-heading" }, text("h2", "Deal stages"), text("span", "Simulated demo", "pill secondary")), board),
    text("h2", "Metrics"),
    element("div", { className: "metrics-grid" },
      panel(text("h3", "By stage"), table(["Stage", "Cards"], stages.map((stage, i) =>
        metricRow([stageLabels[i], metrics.per_stage[stage] || 0])))),
      panel(text("h3", "By path kind"), table(["Path kind", "Paths", "Approved"], metrics.by_path_kind.map(row =>
        metricRow([titleCase(row.kind), row.count, row.approved])))),
      panel(text("h3", "By actor"), table(["Actor", "Type", "Actions"], metrics.by_actor.map(row =>
        metricRow([row.actor, titleCase(row.actor_kind), row.actions]))))
    )
  );
}

const speech = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

function stopVoice() {
  speech?.cancel();
  recognition?.abort();
}

function speakQuestion() {
  const question = state.interview?.question;
  if (!state.muted && speech && question && state.view === "interview") {
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(question);
    utterance.lang = "en-US";
    speech.speak(utterance);
  }
}

function renderInterview() {
  const response = state.interview;
  const done = response?.done;
  $("#interview-question").textContent = done ? "Interview complete" : response?.question || "Start when you’re ready.";
  $("#interview-answer").hidden = !response || done;
  $("#start-interview").hidden = Boolean(response && !done);
  $("#start-interview").textContent = done ? "Restart interview" : "Start interview";
  $("#copy-interview").hidden = !done;
  const transcript = response?.form.interview_transcript;
  const notes = $("#interview-notes");
  notes.hidden = !transcript;
  if (transcript) {
    notes.replaceChildren(
      text("h2", "Transcript"), caption(response.engine === "moss" ? "Moss extraction" : "Scripted interview"),
      text("p", transcript, "transcript")
    );
  }
}

async function interviewTurn(answer) {
  setMessage("#status", answer ? "Submitting answer…" : "Starting interview…");
  stopVoice();
  try {
    state.interview = await request("/interview", {
      method: "POST",
      body: answer ? { session_id: state.interview.session_id, answer } : {}
    });
    $("#interview-answer").reset();
    renderInterview();
    speakQuestion();
  } catch (error) {
    if (answer && error.status === 404) {
      $("#start-interview").hidden = false;
      $("#start-interview").textContent = "Restart interview";
    }
    throw error;
  } finally {
    setMessage("#status", "");
  }
}

$("#start-interview").addEventListener("click", event => run(event.currentTarget, () => interviewTurn()));
formSubmit($("#interview-answer"), form => {
  const answer = form.elements.answer.value.trim();
  if (!answer) throw new Error("Enter an answer.");
  return interviewTurn(answer);
});

$("#copy-interview").addEventListener("click", () => {
  const fields = $("#intake").elements;
  for (const [key, value] of Object.entries(state.interview.form)) {
    const field = fields.namedItem(key);
    if (field && value !== null) field.value = Array.isArray(value) ? value.join("\n") : value;
  }
  navigate("signup");
  fields.namedItem("name").focus();
});

$("#mute").disabled = !speech;
if (!speech) $("#mute").textContent = "Voice playback unavailable";
$("#mute").addEventListener("click", event => {
  state.muted = !state.muted;
  event.currentTarget.setAttribute("aria-pressed", state.muted);
  event.currentTarget.textContent = state.muted ? "Voice muted" : "Voice on";
  if (state.muted) speech.cancel();
  else speakQuestion();
});
$("#dictate").disabled = !Recognition;
if (!Recognition) $("#dictate").textContent = "Dictation unavailable";
$("#dictate").addEventListener("click", () => {
  if (recognition) {
    recognition.stop();
    return;
  }
  speech?.cancel();
  const recognizer = new Recognition();
  recognition = recognizer;
  recognizer.lang = "en-US";
  recognizer.onresult = event => {
    const answer = $("#interview-answer").elements.answer;
    answer.value = [answer.value.trim(), event.results[0][0].transcript].filter(Boolean).join(" ").slice(0, 2000);
  };
  recognizer.onerror = event => {
    $("#speech-status").textContent = event.error === "aborted" ? "" :
      `Dictation unavailable (${event.error}). You can type your answer.`;
  };
  recognizer.onend = () => {
    recognition = null;
    $("#dictate").textContent = "Dictate answer";
    if ($("#speech-status").textContent === "Listening…") $("#speech-status").textContent = "";
  };
  try {
    recognizer.start();
    $("#dictate").textContent = "Stop dictation";
    $("#speech-status").textContent = "Listening…";
  } catch {
    recognition = null;
    $("#speech-status").textContent = "Dictation unavailable. You can type your answer.";
  }
});

const renderers = { icp: renderIcp, leads: renderLeads, draft: renderDrafts, pipeline: renderPipeline };
let visit = 0;
async function navigate(view) {
  const currentVisit = ++visit;
  stopVoice();
  state.graphCleanup?.();
  state.graphCleanup = null;
  state.view = view;
  setMessage("#error", "");
  setMessage("#status", "");
  document.querySelectorAll("main section[aria-labelledby]").forEach(section => {
    section.hidden = section.id !== view;
  });
  document.querySelectorAll("nav [data-view]").forEach(item => {
    if (item.dataset.view === view) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const render = renderers[view];
  if (!render) return;
  const target = $(`#${view}-data`);
  target.replaceChildren();
  if (!state.founder) {
    target.append(panel(caption("Load a founder to use this view."),
      button("Go to sign-up", () => navigate("signup"), "primary")));
    return;
  }
  const content = element("div", { className: target.className }, caption("Loading…"));
  target.append(content);
  try {
    await render(content);
  } catch (error) {
    if (currentVisit === visit) {
      target.replaceChildren(panel(caption("This view could not load."), button("Retry", () => navigate(view))));
      showError(error);
    }
  }
}
document.querySelectorAll("[data-view]").forEach(item => {
  item.addEventListener("click", () => navigate(item.dataset.view));
});
checkConnection();
refreshCredits();
