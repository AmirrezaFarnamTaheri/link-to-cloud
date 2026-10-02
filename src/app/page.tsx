import { RelayApp } from "@/components/relay-app";
import { IconCloudUp } from "@/components/ui";

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <header className="mb-10 max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/30">
            <IconCloudUp className="size-6" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Relay</span>
        </div>
        <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Send any link{" "}
          <span className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">straight to the cloud.</span>
        </h1>
        <p className="mt-4 text-pretty text-base leading-relaxed text-slate-400">
          Paste download links and Relay transfers files from the source to GitHub or Google Drive on the server, with live progress and checksums. Your browser never downloads the file contents; a localhost server uses your computer’s internet connection.
        </p>
      </header>
      <RelayApp />
      <footer className="mt-12 text-center text-xs text-slate-600">Relay · account tokens use an encrypted httpOnly cookie · Drive uses bounded-memory chunks; GitHub buffers files in memory · no file is written to server disk</footer>
    </main>
  );
}
