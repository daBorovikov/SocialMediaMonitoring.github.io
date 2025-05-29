const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.post('/users', async (req, res) => {
  const { login, password, gender } = req.body;
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE login = $1',
      [login]
    );
    if (result.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }
    await pool.query(
      'INSERT INTO users (login, password, gender) VALUES ($1, $2, $3)',
      [login, password, gender]
    );
    res.status(201).json({ message: 'Пользователь создан' });
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT login, password, gender FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});