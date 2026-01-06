// /api/pin.js
const axios = require("axios");

module.exports = async function (req, res) {
    try {
        const q = req.query.q;
        if (!q) {
            return res.status(400).json({
                error: true,
                message: "Missing query ?q="
            });
        }

        const url = "https://www.pinterest.com/resource/BaseSearchResource/get/";

        const params = {
            source_url: `/search/pins/?q=${encodeURIComponent(q)}`,
            data: JSON.stringify({
                options: {
                    query: q,
                    scope: "pins",
                    bookmarks: [""]
                },
                context: {}
            })
        };

        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json, text/javascript, */*"
        };

        const result = await axios.get(url, { params, headers });

        const raw = result.data?.resource_response?.data?.results || [];

        const imgs = raw
            .map((pin) => {
                if (pin.images?.orig) return pin.images.orig.url;
                if (pin.images?.["736x"]) return pin.images["736x"].url;
                return null;
            })
            .filter(Boolean)
            .slice(0, 20);

        res.json({
            error: false,
            query: q,
            count: imgs.length,
            results: imgs
        });
    } catch (e) {
        res.status(500).json({
            error: true,
            message: e.message
        });
    }
};
