export default function SammyPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">Hey Sammy!</h1>
          <p className="text-xl text-slate-300">
            Here&apos;s what Shane told me the plan for this site should be.
          </p>
        </div>

        {/* Overview Section */}
        <section className="mb-12 bg-slate-800/50 p-8 rounded-xl border border-slate-700">
          <h2 className="text-2xl font-bold mb-4 text-blue-400">Overview</h2>
          <p className="text-slate-300 leading-relaxed">
            This is a <strong>bulk address verification tool</strong>. The core flow is:
            <span className="block mt-2 text-lg font-mono bg-slate-900/50 p-4 rounded-lg">
              LinkedIn URLs &rarr; Enrichment &rarr; Address Discovery &rarr; Verification &rarr; Export
            </span>
          </p>
        </section>

        {/* Requirements Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-blue-400">Requirements</h2>

          <div className="space-y-6">
            <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              <div className="flex items-start gap-4">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">1</span>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Authentication</h3>
                  <p className="text-slate-400">
                    Basic login system - Gmail login, email login, something simple. No need to reinvent the wheel.
                    Just need a place where authenticated users can log in and upload stuff.
                  </p>
                  <div className="mt-3 text-sm text-slate-500 bg-slate-900/30 p-3 rounded">
                    Suggestion: NextAuth.js with Google provider would be quick to set up
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              <div className="flex items-start gap-4">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">2</span>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Basic Management Flow</h3>
                  <p className="text-slate-400">
                    After logging in, users should be able to navigate around in a basic sense.
                    Dashboard &rarr; Upload &rarr; View Progress &rarr; Results
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              <div className="flex items-start gap-4">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">3</span>
                <div>
                  <h3 className="text-xl font-semibold mb-2">LinkedIn Upload &rarr; Enrichment UI</h3>
                  <p className="text-slate-400 mb-3">
                    Ability to add LinkedIn URLs, enrich them, and see a UI showing those addresses being enriched all the way through.
                  </p>
                  <ul className="text-slate-400 space-y-2 list-disc list-inside">
                    <li>Upload LinkedIn URLs (paste or CSV)</li>
                    <li>Live enrichment status for each profile</li>
                    <li>Progress indicators as data flows through the pipeline</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              <div className="flex items-start gap-4">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">4</span>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Agent Decision Flow</h3>
                  <p className="text-slate-400 mb-3">
                    Show what the agent is doing, why it&apos;s making decisions, and the reasoning behind each choice.
                  </p>
                  <ul className="text-slate-400 space-y-2 list-disc list-inside">
                    <li>Real-time agent activity log</li>
                    <li>Decision explanations (why home vs. office)</li>
                    <li>Tool calls being made (Endato, PropMix, Exa, etc.)</li>
                    <li>Confidence scoring at each step</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
              <div className="flex items-start gap-4">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">5</span>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Final Address Selection UI</h3>
                  <p className="text-slate-400 mb-3">
                    Rich UI showing the final picked address with full reasoning:
                  </p>
                  <ul className="text-slate-400 space-y-2 list-disc list-inside">
                    <li>Why we picked office vs. home</li>
                    <li>Map visualization showing candidate locations</li>
                    <li>Confidence score with breakdown</li>
                    <li>All the data that led to the decision</li>
                    <li>Click to expand and see full reasoning</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* API Reference Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-green-400">APIs We Use</h2>
          <p className="text-slate-400 mb-6">
            These APIs power the address verification agent. Keys are configured in <code className="bg-slate-800 px-2 py-1 rounded">.env</code>.
          </p>

          <div className="space-y-4">
            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">Bright Data (LinkedIn Enrichment)</h3>
              <p className="text-slate-400 text-sm mb-3">
                LinkedIn profile scraping via Bright Data Datasets API. Returns name, company, title, location, experience. Replaces Proxycurl (shut down Jan 2025).
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Trigger:</div>
                <div className="text-slate-300">POST https://api.brightdata.com/datasets/v3/trigger</div>
                <div className="text-slate-500 mt-2">Env var:</div>
                <div className="text-green-400">BRIGHT_DATA_API_KEY</div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">Endato (People Search)</h3>
              <p className="text-slate-400 text-sm mb-3">
                People search by name. Returns residential address history, phone numbers, age. Best for US addresses. 100 free searches/month.
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Endpoint:</div>
                <div className="text-slate-300">POST https://api.enformion.com/PersonSearch</div>
                <div className="text-slate-500 mt-2">Env vars:</div>
                <div className="text-green-400">ENDATO_API_NAME, ENDATO_API_PASSWORD</div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">PropMix (Property Verification)</h3>
              <p className="text-slate-400 text-sm mb-3">
                Property data lookup — owner name, occupied status, sale history. Covers 151M+ properties across 3,100+ US counties.
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Endpoint:</div>
                <div className="text-slate-300">GET https://api.propmix.io/pubrec/assessor/v1/GetPropertyDetails</div>
                <div className="text-slate-500 mt-2">Env var:</div>
                <div className="text-green-400">PROPMIX_ACCESS_TOKEN</div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">Google Distance Matrix</h3>
              <p className="text-slate-400 text-sm mb-3">
                Calculate driving distance between addresses. Helps determine if person commutes to office or is remote (&gt;50 miles = likely remote).
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Endpoint:</div>
                <div className="text-slate-300">GET https://maps.googleapis.com/maps/api/distancematrix/json</div>
                <div className="text-slate-500 mt-2">Env var:</div>
                <div className="text-green-400">GOOGLE_SEARCH_API_KEY</div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">Exa AI (Web Search)</h3>
              <p className="text-slate-400 text-sm mb-3">
                Neural web search for finding current info about people and companies. Better semantic matching than traditional search engines.
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Endpoint:</div>
                <div className="text-slate-300">POST https://api.exa.ai/search</div>
                <div className="text-slate-500 mt-2">Env var:</div>
                <div className="text-green-400">EXA_AI_KEY</div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-xl border border-green-900/50">
              <h3 className="text-lg font-semibold text-green-400 mb-2">AWS Bedrock (Claude Sonnet 4.5)</h3>
              <p className="text-slate-400 text-sm mb-3">
                Powers the AI agent orchestrator. Claude Sonnet 4.5 with 200K context window runs the iterative tool-calling loop.
              </p>
              <div className="bg-slate-900/50 p-3 rounded text-sm font-mono">
                <div className="text-slate-500">Model:</div>
                <div className="text-slate-300">global.anthropic.claude-sonnet-4-5-20250929-v1:0</div>
                <div className="text-slate-500 mt-2">Env vars:</div>
                <div className="text-green-400">AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION</div>
              </div>
            </div>
          </div>
        </section>

        {/* Agent Logic Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-purple-400">How the Agent Decides</h2>
          <p className="text-slate-400 mb-6">
            From the existing address verification agent in SlurpBot:
          </p>

          <div className="bg-slate-800/50 p-6 rounded-xl border border-purple-900/50">
            <h3 className="text-lg font-semibold text-purple-400 mb-4">Home vs. Office Decision Factors</h3>
            <ul className="text-slate-400 space-y-3">
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Remote/Hybrid Policy:</strong> What does their LinkedIn say about work location?</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Office Package Policy:</strong> Mail rooms don&apos;t convert well. If office policy is bad for packages, suggest courier.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Office Validity:</strong> Is the office still open? Google Maps can show if permanently closed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Contact Point Matching:</strong> If verified contact points match Endato data, high confidence we have the right person.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Common Name Problem:</strong> If &gt;5 Endato results, probably a common name. Get both home and office to be safe.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">&bull;</span>
                <span><strong>Gift Context:</strong> Is the gift better suited for home or office? (Don&apos;t weight heavily, but consider obvious indicators)</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Reference Code Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-orange-400">Reference Code</h2>
          <p className="text-slate-400 mb-4">
            Check out these files in <code className="bg-slate-800 px-2 py-1 rounded">slurpbot_ops</code> for the existing implementation:
          </p>

          <div className="bg-slate-800/50 p-6 rounded-xl border border-orange-900/50 font-mono text-sm space-y-2">
            <div className="text-orange-400"># Agent &amp; Workflow</div>
            <div className="text-slate-300">apps/ops-portal/mastra/agents/address-verification-agent.ts</div>
            <div className="text-slate-300">apps/ops-portal/app/workflows/address-verification.ts</div>

            <div className="text-orange-400 mt-4"># Tools</div>
            <div className="text-slate-300">apps/ops-portal/mastra/tools/prop-mix-tool.ts</div>
            <div className="text-slate-300">apps/ops-portal/mastra/tools/driving-distance-tool.ts</div>
            <div className="text-slate-300">apps/ops-portal/mastra/tools/office-address-research-tool.ts</div>
            <div className="text-slate-300">apps/ops-portal/mastra/tools/exa-web-search-tool.ts</div>

            <div className="text-orange-400 mt-4"># Services</div>
            <div className="text-slate-300">apps/ops-portal/lib/services/prop-mix-service.ts</div>
            <div className="text-slate-300">apps/ops-portal/lib/services/google-distance-service.ts</div>

            <div className="text-orange-400 mt-4"># Types</div>
            <div className="text-slate-300">apps/ops-portal/types/address-verification.ts</div>
            <div className="text-slate-300">apps/ops-portal/types/delivery.ts</div>
          </div>
        </section>

        {/* Action Items */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-red-400">Action Items for You</h2>

          <div className="bg-red-900/20 p-6 rounded-xl border border-red-900/50">
            <ol className="text-slate-300 space-y-4 list-decimal list-inside">
              <li><strong>Set up auth</strong> - basic Google/email login</li>
              <li><strong>Build the upload flow</strong> - paste LinkedIn URLs or upload CSV</li>
              <li><strong>Create enrichment pipeline UI</strong> - show real-time progress</li>
              <li><strong>Build agent decision viewer</strong> - show reasoning as it happens</li>
              <li><strong>Create final address selection UI</strong> - rich, interactive, with maps</li>
              <li><strong>Study the slurpbot_ops code</strong> - evolve and improve on it!</li>
            </ol>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-slate-500 pt-8 border-t border-slate-800">
          <p>Built with slurps by Mr. Slurpy</p>
          <p className="text-sm mt-2">Go make something awesome!</p>
        </footer>
      </div>
    </div>
  );
}
