import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <header className="container mx-auto px-6 py-8">
        <nav className="flex items-center justify-between">
          <div className="text-2xl font-bold">📦 WDISTT</div>
          <div className="flex gap-6">
            <Link href="#features" className="text-slate-300 hover:text-white transition">Features</Link>
            <Link href="#how-it-works" className="text-slate-300 hover:text-white transition">How It Works</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Where Do I Send This Thing?
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 mb-8">
            Bulk address verification for outbound campaigns.<br />
            LinkedIn → Verified Delivery Address
          </p>
          <div className="flex gap-4 justify-center">
            <button className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg font-semibold text-lg transition">
              Get Started
            </button>
            <button className="border border-slate-600 hover:border-slate-500 px-8 py-4 rounded-lg font-semibold text-lg transition">
              Learn More
            </button>
          </div>
        </div>

        {/* Features */}
        <section id="features" className="mt-32">
          <h2 className="text-3xl font-bold text-center mb-12">What It Does</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-800/50 p-8 rounded-xl border border-slate-700">
              <div className="text-4xl mb-4">🔗</div>
              <h3 className="text-xl font-semibold mb-2">LinkedIn Intake</h3>
              <p className="text-slate-400">Drop a list of LinkedIn URLs. We handle the rest.</p>
            </div>
            <div className="bg-slate-800/50 p-8 rounded-xl border border-slate-700">
              <div className="text-4xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold mb-2">Address Discovery</h3>
              <p className="text-slate-400">Multi-source lookup to find the best delivery address.</p>
            </div>
            <div className="bg-slate-800/50 p-8 rounded-xl border border-slate-700">
              <div className="text-4xl mb-4">✅</div>
              <h3 className="text-xl font-semibold mb-2">Verification</h3>
              <p className="text-slate-400">Confidence scoring and human review workflow.</p>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="mt-32">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="max-w-2xl mx-auto">
            <div className="flex items-start gap-4 mb-8">
              <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shrink-0">1</div>
              <div>
                <h3 className="text-xl font-semibold mb-1">Upload LinkedIn URLs</h3>
                <p className="text-slate-400">Paste a list or upload a CSV with prospect LinkedIn profiles.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 mb-8">
              <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shrink-0">2</div>
              <div>
                <h3 className="text-xl font-semibold mb-1">Automated Enrichment</h3>
                <p className="text-slate-400">We pull from multiple data sources to find current addresses.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 mb-8">
              <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shrink-0">3</div>
              <div>
                <h3 className="text-xl font-semibold mb-1">Review & Verify</h3>
                <p className="text-slate-400">Human-in-the-loop verification for high-confidence delivery.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shrink-0">4</div>
              <div>
                <h3 className="text-xl font-semibold mb-1">Export & Ship</h3>
                <p className="text-slate-400">Download verified addresses ready for your campaigns.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-12 mt-20 border-t border-slate-800">
        <div className="text-center text-slate-500">
          <p>Built by Wildcard 🃏</p>
        </div>
      </footer>
    </div>
  );
}
