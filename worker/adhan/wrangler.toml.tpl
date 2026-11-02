name = "mallah-adhan"
main = "src/index.js"
compatibility_date = "2025-07-18"

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "mallah-adhan"
database_id = "@@DBID@@"
