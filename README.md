# Allergen Detector MCP

The Allergen Detector matching engine as an MCP server, so AI assistants and shopping agents (ChatGPT, Claude, and others) can check a product against a household's allergies before recommending or buying it.

It uses the same `matcher.js` and allergen map as the Chrome extension (51 allergens, 1,078 names). The map refreshes daily from GitHub, so map updates reach agents with no redeploy.

## Tools

| Tool | What it does |
|---|---|
| `check_product_allergens` | Checks an ingredient list against one or more people's allergens (with severity) and returns who is affected, by which ingredient, and why. "Free from" claims never hide a real ingredient. |
| `lookup_ingredient` | Tells which allergen an ingredient name belongs to ("sodium caseinate" → milk). |
| `list_supported_allergens` | Lists the allergens the service covers. |

All tools are read-only and stateless. Nothing about the person (allergens, ingredients) is stored or logged. The only log is an anonymous count of tool calls per day, for measuring traction.

## Run it

```bash
npm install
npm test           # end-to-end test over MCP
npm start          # remote server: http://localhost:3000/mcp
npm run stdio      # local server for Claude Desktop and similar
npm run sync       # copy the latest matcher.js and map from the extension
```

To use it locally in Claude Desktop, add this to the `mcpServers` section of its config:

```json
"allergen-detector": { "command": "node", "args": ["/Users/lingyaomeng/try/allergen-mcp/server.js", "--stdio"] }
```

## Launch steps

1. **Host it** at a public HTTPS URL. Render or Fly.io can run `npm start` from a GitHub repo for $0–7/month. Later, point `mcp.safi.ai` at it.
2. **Privacy policy and terms page.** Every directory requires one. Until safi.ai is live, host it on GitHub Pages. Its main point: no health data is stored.
3. **List it in the official MCP Registry** (registry.modelcontextprotocol.io) with the `mcp-publisher` CLI, under `io.github.daniellemeng1022/allergen-detector`. Many clients and directories pull from it.
4. **Submit to the community directories:** Smithery, Glama, PulseMCP and mcp.so.
5. **Claude:** anyone can add it today as a custom connector by pasting the URL. To appear in Anthropic's connectors directory, submit it through their directory form.
6. **ChatGPT:** test it in developer mode, then submit it as an app through OpenAI's Apps SDK submission process. This needs a verified developer account.
7. **Meta Muse (do this first):** submit at muse.ai/platform. Choose "Existing MCP," enter the hosted URL, set authentication to none (or an API key) and payments to "no," then describe the service. Meta tests the live endpoint, so step 1 has to be done first. Muse already shops at Sephora, Walmart, Best Buy and the Shopify catalog, which covers both of our categories (cosmetics and food).
8. **Instinct and similar assistants:** Instinct doesn't document custom MCP support. It shops through Shopify and Shop Pay. Reach out for a partnership instead.
9. **Shopping agents:** contact teams building agentic-commerce products and offer the endpoint free during a pilot.
10. **Measure:** set `STATS_KEY` on the host, then open `https://<your-url>/stats?key=<STATS_KEY>` to see calls by day, agent and tool. A `connect` count is an agent connecting; tool counts are real checks. `/stats` resets when the server restarts, but every count is also a `[usage]` JSON line in the host's logs. Track weekly checks and the number of distinct agents.

## Before scaling

- Add rate limiting and an API key for heavy business users. Keep a free tier.
- Keep the disclaimer in every response. Don't present results as medical advice.
