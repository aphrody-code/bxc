export default {
	async fetch(req: Request) {
		const u = new URL(req.url);
		const url = u.searchParams.get("url");
		if (!url)
			return Response.json(
				{ ok: false, error: "missing 'url'" },
				{ status: 400 },
			);
		return Response.json({ ok: true });
	},
};
