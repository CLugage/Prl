const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register User
const register = async (req, res) => {
  const { username, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({ username, email, password: hashedPassword });

  try {
    await user.save();
    res.status(201).redirect('/login');
  } catch (error) {
    res.status(400).send('Error registering user');
  }
};

// Login User
const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).send('Invalid credentials');

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).send('Invalid credentials');

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  req.session.token = token;
  res.redirect('/dashboard');
};

// Dashboard
const dashboard = (req, res) => {
  if (!req.session.token) return res.redirect('/login');
  res.render('dashboard');
};

module.exports = { register, login, dashboard };
