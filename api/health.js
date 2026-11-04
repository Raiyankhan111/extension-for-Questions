module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  return res.status(200).json({
    status: 'online',
    service: 'PortalMind AI Backend (Vercel Serverless)',
    keyConfigured: Boolean(apiKey && apiKey.length > 5),
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  });
};
