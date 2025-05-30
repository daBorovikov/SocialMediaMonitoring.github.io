require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Класс для работы с актуальным API FusionBrain
class FusionBrainAPI {
  constructor(apiKey, secretKey) {
    this.baseURL = 'https://api-key.fusionbrain.ai/';
    this.headers = {
      'X-Key': `Key ${apiKey}`,
      'X-Secret': `Secret ${secretKey}`,
    };
  }

  async getPipelines() {
    try {
      const response = await axios.get(`${this.baseURL}key/api/v1/pipelines`, {
        headers: this.headers
      });
      return response.data;
    } catch (error) {
      console.error('Ошибка получения пайплайнов:', error.response?.data || error.message);
      throw new Error(`Не удалось получить список моделей: ${error.message}`);
    }
  }

  async checkAvailability(pipelineId) {
    try {
      const response = await axios.get(`${this.baseURL}key/api/v1/pipeline/${pipelineId}/availability`, {
        headers: this.headers
      });
      return response.data;
    } catch (error) {
      console.error('Ошибка проверки доступности:', error.response?.data || error.message);
      return { pipeline_status: 'UNKNOWN' };
    }
  }

  async generate(pipelineId, prompt, options = {}) {
    try {
      const form = new FormData();
      
      const params = {
        type: "GENERATE",
        numImages: 1,
        width: options.width || 1024,
        height: options.height || 1024,
        generateParams: {
          query: prompt
        }
      };

      // Добавляем стиль если указан
      if (options.style) {
        params.style = options.style;
      }

      // Добавляем негативный промпт если указан
      if (options.negative) {
        params.negativePromptDecoder = options.negative;
      }

      form.append('pipeline_id', pipelineId);
      form.append('params', JSON.stringify(params), { contentType: 'application/json' });

      console.log('Отправляем запрос на генерацию:', JSON.stringify(params, null, 2));

      const response = await axios.post(`${this.baseURL}key/api/v1/pipeline/run`, form, {
        headers: {
          ...this.headers,
          ...form.getHeaders()
        }
      });

      return response.data;
    } catch (error) {
      console.error('Ошибка генерации:', error.response?.data || error.message);
      throw new Error(`Ошибка запуска генерации: ${error.response?.data?.message || error.message}`);
    }
  }

  async checkStatus(uuid) {
    try {
      const response = await axios.get(`${this.baseURL}key/api/v1/pipeline/status/${uuid}`, {
        headers: this.headers
      });
      return response.data;
    } catch (error) {
      console.error('Ошибка проверки статуса:', error.response?.data || error.message);
      throw new Error(`Ошибка проверки статуса: ${error.message}`);
    }
  }
}

// Создаем экземпляр API
const fusionAPI = new FusionBrainAPI(
  process.env.FUSION_API_KEY,
  process.env.FUSION_SECRET_KEY
);

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

// Эндпоинт для проверки API
app.get('/api-status', async (req, res) => {
  try {
    const pipelines = await fusionAPI.getPipelines();
    console.log('Доступные пайплайны:', pipelines);
    
    if (pipelines && pipelines.length > 0) {
      const availability = await fusionAPI.checkAvailability(pipelines[0].id);
      res.json({ 
        status: 'available', 
        pipelines: pipelines.length,
        models: pipelines,
        availability: availability
      });
    } else {
      res.status(500).json({ 
        status: 'no_models', 
        error: 'Нет доступных моделей' 
      });
    }
  } catch (error) {
    console.error('Ошибка проверки API:', error);
    res.status(500).json({ 
      status: 'unavailable', 
      error: error.message 
    });
  }
});

app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt || prompt.length > 1000) {
    return res.status(400).json({ error: 'Неверное или отсутствующее описание (максимум 1000 символов)' });
  }

  try {
    console.log('Начинаем генерацию изображения для промпта:', prompt);
    
    // Получаем доступные пайплайны
    const pipelines = await fusionAPI.getPipelines();
    console.log('Получены пайплайны:', pipelines.map(p => ({ id: p.id, name: p.name, status: p.status })));
    
    if (!pipelines || pipelines.length === 0) {
      throw new Error('Нет доступных моделей');
    }

    // Берем первый активный пайплайн (Kandinsky)
    const activePipeline = pipelines.find(p => p.status === 'ACTIVE');
    if (!activePipeline) {
      throw new Error('Нет активных моделей');
    }

    console.log('Используем пайплайн:', activePipeline.name, 'ID:', activePipeline.id);

    // Проверяем доступность модели
    const availability = await fusionAPI.checkAvailability(activePipeline.id);
    console.log('Доступность модели:', availability);
    
    if (availability.pipeline_status && availability.pipeline_status !== 'ACTIVE') {
      throw new Error(`Модель временно недоступна: ${availability.pipeline_status}`);
    }

    // Запускаем генерацию
    const generation = await fusionAPI.generate(activePipeline.id, prompt, {
      style: 'DEFAULT',
      width: 1024,
      height: 1024
    });

    console.log('Генерация запущена:', generation);

    if (!generation.uuid) {
      throw new Error('Не получен UUID задачи');
    }

    // Ожидание завершения с улучшенной логикой
    const maxAttempts = 30; // увеличили до 30 попыток
    const initialDelay = 15000; // начальная задержка 15 секунд
    const checkDelay = 5000; // задержка между проверками 5 секунд
    
    console.log(`Задача создана с UUID: ${generation.uuid}, ожидаем ${initialDelay/1000} секунд перед первой проверкой`);
    
    // Начальная задержка
    await new Promise(resolve => setTimeout(resolve, initialDelay));
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Проверка статуса задачи, попытка ${attempt}/${maxAttempts}`);
        const status = await fusionAPI.checkStatus(generation.uuid);
        
        console.log(`Статус: ${status.status}`, status.censored ? '(заблокировано цензурой)' : '');
        
        if (status.status === 'DONE') {
          if (status.censored) {
            throw new Error('Изображение заблокировано системой модерации. Попробуйте изменить описание.');
          }
          
          if (status.result && status.result.files && status.result.files.length > 0) {
            console.log('Генерация успешно завершена');
            return res.json({ 
              image: status.result.files[0],
              uuid: generation.uuid,
              status: 'success'
            });
          } else {
            throw new Error('Генерация завершена, но файлы отсутствуют');
          }
        }
        
        if (status.status === 'FAIL') {
          const errorMsg = status.errorDescription || 'Генерация завершилась с ошибкой';
          throw new Error(errorMsg);
        }
        
        // Если статус еще обрабатывается
        if (['INITIAL', 'PROCESSING'].includes(status.status)) {
          if (attempt < maxAttempts) {
            console.log(`Задача еще обрабатывается, ждем ${checkDelay/1000} секунд...`);
            await new Promise(resolve => setTimeout(resolve, checkDelay));
          }
        } else {
          console.log(`Неизвестный статус: ${status.status}`);
        }
        
      } catch (statusError) {
        console.error(`Ошибка при проверке статуса (попытка ${attempt}):`, statusError.message);
        
        // Если это последняя попытка, прерываем
        if (attempt >= maxAttempts) {
          throw statusError;
        }
        
        // Иначе ждем и пробуем еще раз
        await new Promise(resolve => setTimeout(resolve, checkDelay));
      }
    }
    
    throw new Error(`Превышено время ожидания (${maxAttempts * checkDelay / 1000} секунд). Попробуйте позже.`);
    
  } catch (error) {
    console.error('Ошибка генерации изображения:', error);
    
    // Более детальная обработка ошибок
    let errorMessage = 'Произошла ошибка при генерации изображения';
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorMessage = 'Ошибка авторизации. Проверьте API ключи.';
    } else if (error.message.includes('400') || error.message.includes('Bad Request')) {
      errorMessage = 'Некорректный запрос. Проверьте параметры.';
    } else if (error.message.includes('404')) {
      errorMessage = 'API эндпоинт не найден. Возможно, API изменился.';
    } else if (error.message.includes('цензур') || error.message.includes('модерац')) {
      errorMessage = 'Запрос заблокирован системой модерации. Измените описание.';
    } else if (error.message.includes('недоступна') || error.message.includes('DISABLED')) {
      errorMessage = 'Сервис временно недоступен из-за высокой нагрузки. Попробуйте позже.';
    } else {
      errorMessage = error.message;
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log('Для проверки API используйте GET /api-status');
});