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

  // Language gate: a short word only counts on text in its own language.
  const words = (x) => x.people[0].alerts.flatMap(a => a.found_as).map(w => w.toLowerCase());
  r = await call('check_product_allergens', {
    ingredients: 'Ingredients: sugar, salt, rice. Made in Malta.',
    household: [{ allergens: ['gluten'] }]
  });
  assert.ok(!words(r).includes('malta'), 'Malta on an English label is not malt');
  assert.ok(r.people[0].other_language_words_not_counted.some(w => w.word.toLowerCase() === 'malta'), 'a skipped word must be reported');

  r = await call('check_product_allergens', {
    ingredients: 'Ingredientes: agua, malta de cebada, azúcar',
    household: [{ allergens: ['gluten'] }]
  });
  assert.ok(words(r).includes('malta'), 'malta on a Spanish label is malt');

  r = await call('check_product_allergens', {
    ingredients: 'Ingrédients : farine, lait écrémé, sucre',
    household: [{ allergens: ['milk'] }]
  });
  assert.ok(words(r).includes('lait'), 'lait on a French label is milk');

  r = await call('check_product_allergens', {
    ingredients: 'rice, salt, maito',
    household: [{ allergens: ['milk'] }],
    language: 'fi'
  });
  assert.ok(words(r).includes('maito'), 'the language the caller gives always counts');

  r = await call('check_product_allergens', {
    ingredients: 'vatten, tomat, lök, vitlök, räkor',
    household: [{ allergens: ['shellfish'] }]
  });
  assert.strictEqual(r.no_listed_allergens_found, false, 'a short list with no label must not lose a real word');

  // Typed in Chinese, found on a label in another language.
  r = await call('check_product_allergens', {
    ingredients: 'Ingredients: sugar, almond, salt',
    household: [{ allergens: ['杏仁'] }]
  });
  assert.strictEqual(r.no_listed_allergens_found, false, 'an allergen typed in Chinese must work on an English label');

  r = await call('lookup_ingredient', { ingredient: 'lait' });
  assert.ok(r.allergens.length > 0, 'a lookup with no language checks every language');

  r = await call('lookup_ingredient', { ingredient: 'Prunus Amygdalus Dulcis (Sweet Almond) Oil' });
  assert.ok(r.allergens.some(a => /nut/i.test(a.allergen)));

  r = await call('list_supported_allergens', {});
  assert.ok(r.count >= 50);

  await client.close();
  console.log('All MCP tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
