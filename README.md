# UGC Factory — Render Deployment Guide

## Быстрый деплой на Render.com (бесплатно)

### Шаг 1: Подготовь проект

У тебя уже есть готовые файлы. Просто загрузи их на GitHub:

```bash
# 1. Создай новый репозиторий на GitHub (без README, без .gitignore)
# 2. В папке проекта выполни:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ТВОЙ_НИК/ugc-factory.git
git push -u origin main
```

### Шаг 2: Подключи Render

1. Зайди на [render.com](https://render.com) и зарегистрируйся (через GitHub)
2. Нажми **"New +"** → **"Web Service"**
3. Выбери свой GitHub-репозиторий `ugc-factory`
4. Заполни настройки:

| Поле | Значение |
|------|----------|
| **Name** | `ugc-factory` (или любое) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | `Free` |

5. Нажми **"Advanced"** и добавь переменную окружения:
   - **Key**: `WAVESPEED_API_KEY`
   - **Value**: `ws_live_xxxxxxxxxxxxxxxx` (твой ключ с wavespeed.ai)

6. Нажми **"Create Web Service"**

### Шаг 3: Жди деплой

Render автоматически:
- Установит Node.js 18+
- Установит зависимости (`npm install`)
- Скачает `ffmpeg-static` (бинарник FFmpeg)
- Запустит сервер

Это займёт **2–3 минуты**. Когда статус станет **"Live"** — сервер готов.

### Шаг 4: Получи URL

Render даст тебе URL вида:
```
https://ugc-factory.onrender.com
```

Скопируй его — он понадобится в PWA.

### Шаг 5: Настрой PWA на телефоне

1. Открой `public/index.html` в редакторе
2. Найди строку с `serverUrl` placeholder
3. Или просто открой сайт на телефоне и вставь URL в поле "Настройки сервера"
4. Нажми **"Добавить на домашний экран"**:
   - **iPhone**: Safari → Поделиться → На экран "Домой"
   - **Android**: Chrome → Меню → Добавить на главный экран

---

## ⚠️ Важно про Free Plan

| Ограничение | Что это значит |
|-------------|--------------|
| **Sleep after 15 min** | Сервер засыпает без запросов. Первая генерация после сна займёт **30–60 сек** вместо 5 сек |
| **512 MB RAM** | Достаточно для нашего пайплайна |
| **100 GB трафика/мес** | ~1000 видео в месяц |
| **Нет постоянного диска** | Файлы в `temp/` и `output/` удаляются при перезапуске. Скачивай видео сразу! |

---

## 🔧 Отладка

Если деплой падает, проверь логи на Render:
1. Dashboard → твой сервис → **Logs**
2. Ищи ошибки

Частые проблемы:
- **"WAVESPEED_API_KEY is missing"** → добавь env переменную в настройках Render
- **"FFmpeg not found"** → `ffmpeg-static` должен был установиться. Проверь `npm install` логи
- **"Port already in use"** → Render сам назначает порт через `PORT` env. Не хардкодь порт!

---

## 💰 Стоимость

| Сервис | Цена |
|--------|------|
| Render Free | $0 |
| WaveSpeed AI (~$0.92/видео) | Пополняешь баланс на wavespeed.ai |
| **Итого старт** | **$5–10** на баланс WaveSpeed + $0 на Render |
