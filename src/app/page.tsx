import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 mb-4">
          CrewBrain
        </h1>
        <p className="text-xl text-gray-600 mb-10">
          Workforce management for your crew — scheduling, shifts, and 1099 tax tools.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/bigcrew"
            className="px-8 py-3 rounded-lg bg-yellow-400 text-gray-900 font-semibold hover:bg-yellow-300 transition-colors"
          >
            Open BigCrew NYC
          </Link>
          <Link
            href="/login"
            className="px-8 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-8 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 transition-colors"
          >
            Create Account
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 text-left">
          <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="text-2xl mb-2">📅</div>
            <h3 className="font-semibold text-gray-900 mb-1">Shift Scheduling</h3>
            <p className="text-sm text-gray-500">Post shifts, assign crew, and manage your full calendar in one place.</p>
          </div>
          <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="text-2xl mb-2">📱</div>
            <h3 className="font-semibold text-gray-900 mb-1">Mass Text</h3>
            <p className="text-sm text-gray-500">Send SMS to your entire crew or select members instantly.</p>
          </div>
          <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="text-2xl mb-2">💰</div>
            <h3 className="font-semibold text-gray-900 mb-1">1099 Tax Tools</h3>
            <p className="text-sm text-gray-500">Track hours, log expenses, and estimate quarterly taxes automatically.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
