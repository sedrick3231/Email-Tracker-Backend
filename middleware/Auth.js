require('dotenv').config(); // make sure .env is loaded

module.exports = function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token']; // client must send token in header

  if (!token) {
    return res.status(401).json({ error: 'No admin token provided' });
  }

  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  // Token is valid, allow request to proceed
  next();
};
