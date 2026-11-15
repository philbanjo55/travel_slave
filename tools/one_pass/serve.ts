// Serve a solver-replay index.ts on SR_PORT (index.ts calls Deno.serve(handler) itself).
const port = Number(Deno.env.get('SR_PORT') ?? 8000);
const orig = Deno.serve.bind(Deno);
(Deno as any).serve = (h: any) => orig({ port, hostname: '127.0.0.1', onListen: () => console.log('listening', port) }, h);
await import(Deno.env.get('SR_FILE')!);
