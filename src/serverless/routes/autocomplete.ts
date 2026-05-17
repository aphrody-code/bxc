export default {
	async fetch(req: Request) {
		const u = new URL(req.url);
		const q = u.searchParams.get("q");
		if (!q) return Response.json({ ok: false, error: "missing 'q'" }, { status: 400 });
		return Response.json({ ok: true });
	}
};
