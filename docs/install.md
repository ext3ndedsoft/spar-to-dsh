# Установка

Плагин — это папка с шестью файлами и одна строка в `cordis.patch.yml`. Ниже
оба пути: скриптом и руками.

## Скриптом

```bash
git clone https://github.com/ext3ndedsoft/spar-to-dsh.git
cd spar-to-dsh
node install.mjs
```

Что делает:

- копирует `plugins/spar` в `~/.dsh/profiles/web/plugins/spar`;
- дописывает запись `insert` в `~/.dsh/profiles/web/cordis.patch.yml`, если её
  там ещё нет (существующую не трогает);
- создаёт `~/.dsh/spar` под транскрипты.

Повторный запуск ничего не дублирует и не перезаписывает уже отредактированные
файлы: для перезаписи есть `--force`, для просмотра без записи — `--dry-run`.
Если DSH живёт не в `~/.dsh`, передайте `--dsh-home` или `--profile`.

Дальше: **перезапустить оболочку DSH**. Пилюля `◈` появляется в правом нижнем
углу, карточки споров — в чате.

## Руками

```bash
mkdir -p ~/.dsh/profiles/web/plugins
cp -r plugins/spar ~/.dsh/profiles/web/plugins/spar
```

В `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: spar
      name: "./plugins/spar/index.js"
      config:
        judge: deepseek              # или provider/model из каталога
        defaultOpponent: gemini
        language: ru
        tools: true
        maxToolRounds: 3
        maxReplyTokens: 8192
        judgeTokens: 16384
        timeoutMs: 180000
```

`config` необязателен: всё, что не задано, берётся из дефолтов плагина, а
модели и бюджеты потом меняются в панели без правки YAML.

## Как это выглядит в работе

```text
агент ──span──► spar open "<тема>"
                 │  оппонент читает проект своими тулами (read/grep/glob/git)
                 ▼
            /spar-live ──► карточка в чате рисует ход по мере генерации
                 │
                 ▼
            spar result dN ──► текст ответа в контекст агента
                 │
                 ▼
            spar verdict dN ──► приговор: судья в чистом контексте, стороны
                                 обезличены, порядок переставлен по хэшу
```

## Проверка

```bash
cd ~/.dsh/profiles/web/plugins/spar
node test.mjs          # офлайн-набор, без сети
node smoke-client.cjs  # рендер всех состояний карточки без браузера
```

## Удаление

```bash
rm -rf ~/.dsh/profiles/web/plugins/spar ~/.dsh/spar
```

И уберите запись `id: spar` из `cordis.patch.yml`. Ничего другого плагин не
создаёт.

## Если что-то не так

**Пилюли нет.** Проверьте, что профиль перезапущен, и что в `cordis.patch.yml`
запись `- id: spar` находится внутри `insert` (YAML оставляет только последний
ключ `insert`, если их два).

**Карточки без стилей, текст слипся.** Значит клиентский бандл не перезагрузился:
перезапустите оболочку полностью, а не вкладку. Плагин сам вставляет два
`<style>` — карточный и панельный, — и проверяет их в `smoke-client.cjs`.

**Ход висит.** `timeoutMs` по умолчанию 180 с; провайдеры вроде antigravity
отвечают 30–100 с, инструментальные раунды дольше. Ошибка провайдера
записывается в транскрипт и снимает флаг ожидания — `result` не будет ждать
вечно.