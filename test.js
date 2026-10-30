// test.js - Runs the server over stdio like a real MCP client would, and checks
// the answers. Run: npm test
const assert = require('assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [__dirname + '/server.js', '--stdio'], stderr: 'ignore' }));

  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepStrictEqual(tools, ['check_product_allergens', 'list_supported_allergens', 'lookup_ingredient']);

  const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

  let r = await call('check_product_allergens', {
    ingredients: 'Ingredients: sugar, arachis oil, sodium caseinate, salt',
    household: [
      { person: 'Ava', allergens: [{ name: 'peanut', severity: 'severe' }] },
      { person: 'Dad', allergens: ['milk'] },
      { person: 'Mom', allergens: ['shellfish'] }
    ]
  });
  assert.strictEqual(r.safe_for_everyone, false);
  assert.strictEqual(r.worst_severity, 'severe');
  assert.deepStrictEqual(r.people.map(p => p.safe), [false, false, true]);

  r = await call('check_product_allergens', {
    ingredients: 'Gluten-free! Ingredients: rice flour, malted barley, salt',
    household: [{ allergens: ['gluten'] }]
  });
  assert.strictEqual(r.safe_for_everyone, false, 'a gluten-free claim must not hide barley');

  r = await call('check_product_allergens', {
    ingredients: 'Ingredients: rice, coconut milk, salt',
    household: [{ allergens: ['milk'] }]
  });
  assert.strictEqual(r.safe_for_everyone, true, 'coconut milk is not milk');
  assert.strictEqual(r.no_listed_allergens_found, true);
  assert.ok(r.limits.some(l => /may contain/.test(l)), 'a clean result must carry its limits');

  r = await call('lookup_ingredient', { ingredient: 'Prunus Amygdalus Dulcis (Sweet Almond) Oil' });
  assert.ok(r.allergens.some(a => /nut/i.test(a.allergen)));

  r = await call('list_supported_allergens', {});
  assert.ok(r.count >= 50);

  await client.close();
  console.log('All MCP tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
