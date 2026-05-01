# Energomat MVP

Startowa wersja systemu Energomat:
- rejestracja
- logowanie
- panel klienta
- CRM agenta/admina
- zapis leadów
- prosty czat kontaktowy
- baza SQLite w pliku `energomat.db`

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env
npm start
```

Potem otwórz:

```text
http://localhost:3000
```

## Domyślne konto admina

Ustaw w `.env`:

```text
ADMIN_EMAIL=admin@energomat.org
ADMIN_PASSWORD=ZmienHaslo123!
```

Po pierwszym starcie backend utworzy admina automatycznie.

## Ważne

Tego nie uruchomisz na zwykłym hostingu FTP. Potrzebujesz:
- VPS
- Render
- Railway
- hosting Node.js

FileZilla może potem służyć tylko do wrzucania plików statycznych, ale backend musi działać jako aplikacja Node.js.
