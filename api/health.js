module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    status: 'online',
    service: 'PortalMind AI Backend (Active)',
    keyConfigured: true,
    engine: 'AI Question Solver Ready',
    model: 'gemini-1.5-flash'
  });
};
