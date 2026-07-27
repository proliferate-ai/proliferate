const { Sandbox } = await import("e2b");
try { const r = await Sandbox.kill("inc8wykyzzrz7y4161h67", { apiKey: process.env.E2B_API_KEY }); console.log("killed:", r); } catch(e){ console.log("kill err:", String(e).slice(0,200)); }
try { await Sandbox.connect("inc8wykyzzrz7y4161h67", { apiKey: process.env.E2B_API_KEY }); console.log("STILL ALIVE"); } catch(e){ console.log("confirmed gone:", String(e).slice(0,120)); }
