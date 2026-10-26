// server.js - Allergen Detector MCP server. Lets AI agents (shopping agents,
// ChatGPT, Claude) check a product's ingredients against a household's allergies,
// using the same matching engine and allergen map as the Chrome extension.
// Run: `npm start` (remote, Streamable HTTP on /mcp) or `npm run stdio` (local).
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const M = require('./lib/matcher.js');

const MAP_URL = 'https://raw.githubusercontent.com/daniellemeng1022/allergen-map/main/allergen-map.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const DISCLAIMER = 'Informational only, not medical advice. Always read the package label; ingredients and formulas change.';

// Start from the bundled map, then pick up newer published versions daily,
// the same way the extension does.
let map = require('./lib/allergen-map.json');
async function refreshMap() {
  try {
    const res = await fetch(MAP_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const next = await res.json();
    if (next && next.allergens && next.version > map.version) map = next;
  } catch (e) { /* keep the map we have */ }
}

// Anonymous usage counts for traction: day, which agent (client) and which tool.
// No ingredients, allergens, IPs or anything about the person is ever logged.
// Each count is also printed as one JSON line, so the host's logs keep a record
// across restarts.
const usage = {};
function count(tool, client) {
  const day = new Date().toISOString().slice(0, 10);
  client = client || 'unknown';
  const byClient = (usage[day] ||= {})[client] ||= {};
  byClient[tool] = (byClient[tool] || 0) + 1;
  console.error('[usage] ' + JSON.stringify({ day, client, tool }));
}

// Names the agent behind an HTTP request. The MCP "initialize" message carries
// the client's own name (e.g. "claude-ai", "openai-mcp"); later requests only
// have the User-Agent header, so fall back to its first word.
function clientName(req) {
  const msgs = [].concat(req.body || []);
  const init = msgs.find(m => m && m.method === 'initialize');
  const name = init?.params?.clientInfo?.name || (req.get('user-agent') || '').split(/[\/\s]/)[0];
  return name.replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown';
}

const Severity = z.enum(['mild', 'moderate', 'severe']);
const Person = z.object({
  person: z.string().optional().describe('Who this is for, e.g. "me", "Ava", "Dad". Optional.'),
  allergens: z.array(z.union([
    z.string(),
    z.object({ name: z.string(), severity: Severity.optional() })
  ])).min(1).describe('Allergens in plain words, e.g. "peanut", "milk", "fragrance", "nickel". Add a severity to rank alerts.')
});

function asLine(a) {
  return typeof a === 'string' ? a : (a.severity ? `${a.name}: ${a.severity}` : a.name);
}

function reply(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function checkProduct({ ingredients, household, product_name }) {
  const results = household.map((p, i) => {
    const matches = M.findMatches(ingredients, p.allergens.map(asLine), map);
    return {
      person: p.person || (household.length === 1 ? 'user' : `person ${i + 1}`),
      safe: matches.length === 0,
      alerts: matches.map(m => ({
        allergen: m.label,
        severity: m.severity,
        found_as: m.hits.map(h => h.term),
        why: m.hits.map(h => h.why).filter(Boolean),
        label_claims: m.claim || undefined
      }))
    };
  });
  const unsafe = results.filter(r => !r.safe);
  const worst = unsafe.length ? M.worstSeverity(unsafe.flatMap(r => r.alerts)) : null;
  return {
    product: product_name || undefined,
    verdict: unsafe.length === 0
      ? 'No listed allergens found in these ingredients.'
      : `Contains allergens for ${unsafe.map(r => r.person).join(', ')} (worst: ${worst}).`,
    safe_for_everyone: unsafe.length === 0,
    worst_severity: worst,
    people: results,
    map_version: map.version,
    disclaimer: DISCLAIMER
  };
}

function buildServer(client) {
  const server = new McpServer({ name: 'allergen-detector', version: '0.1.0' });
  // Over stdio, the client's name is known once it has connected.
  const track = (tool) => count(tool, client || server.server.getClientVersion()?.name);
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('check_product_allergens', {
    title: 'Check a product for allergens',
    description: 'Check a product\'s ingredient list against the allergies of one or more people in a household. ' +
      'Catches allergens listed under other names (e.g. "arachis oil" for peanut, "casein" for milk, Latin plant names in cosmetics) ' +
      'and does not let "free from" claims hide a real ingredient. Covers food and cosmetics. ' +
      'Call this before recommending or buying a food, cosmetic or household product for someone with allergies.',
    inputSchema: {
      ingredients: z.string().min(1).describe('The product\'s ingredient list, or the product page text that contains it.'),
      household: z.array(Person).min(1).describe('One entry per person, each with their allergens.'),
      product_name: z.string().optional().describe('Product name, for the answer only.')
    },
    annotations: readOnly
  }, async (args) => { track('check_product_allergens'); return reply(checkProduct(args)); });

  server.registerTool('lookup_ingredient', {
    title: 'Look up an ingredient',
    description: 'Tell which allergens, if any, an ingredient name belongs to, e.g. "sodium caseinate" -> milk, ' +
      '"Prunus amygdalus dulcis oil" -> tree nuts, "DMDM hydantoin" -> formaldehyde releasers.',
    inputSchema: { ingredient: z.string().min(1).describe('One ingredient name as printed on a label.') },
    annotations: readOnly
  }, async ({ ingredient }) => {
    track('lookup_ingredient');
    const keys = Object.keys(map.allergens);
    const found = M.findMatches(ingredient, keys.map(k => k.replace(/_/g, ' ')), map);
    return reply({
      ingredient,
      allergens: found.map(m => ({ allergen: m.label, found_as: m.hits.map(h => h.term), why: m.hits.map(h => h.why).filter(Boolean) })),
      map_version: map.version,
      disclaimer: DISCLAIMER
    });
  });

  server.registerTool('list_supported_allergens', {
    title: 'List supported allergens',
    description: 'List the allergens this service can check (food and cosmetic), with the other names users may type for them.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    track('list_supported_allergens');
    const allergens = Object.entries(map.allergens).map(([key, e]) => ({
      id: key, name: e.label, also_called: e.aliases || [], label_names_known: (e.terms || []).length
    }));
    return reply({ count: allergens.length, allergens, map_version: map.version });
  });

  return server;
}

async function main() {
  refreshMap();
  setInterval(refreshMap, REFRESH_MS).unref();

  if (process.argv.includes('--stdio')) {
    await buildServer().connect(new StdioServerTransport());
    return;
  }

  // Remote mode: stateless Streamable HTTP, a fresh server per request.
  const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.get('/', (req, res) => res.json({ name: 'Allergen Detector MCP', mcp: '/mcp', map_version: map.version }));
  app.get('/health', (req, res) => res.send('ok'));
  // Usage totals by day, agent and tool. Private: set STATS_KEY on the host and
  // open /stats?key=<STATS_KEY>.
  app.get('/stats', (req, res) => {
    if (!process.env.STATS_KEY || req.query.key !== process.env.STATS_KEY) return res.status(404).end();
    res.json(usage);
  });
  app.post('/mcp', async (req, res) => {
    const client = clientName(req);
    if ([].concat(req.body || []).some(m => m && m.method === 'initialize')) count('connect', client);
    const server = buildServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.error(`Allergen Detector MCP on :${port}/mcp (map v${map.version})`));
}

if (require.main === module) main();
module.exports = { checkProduct, buildServer };
