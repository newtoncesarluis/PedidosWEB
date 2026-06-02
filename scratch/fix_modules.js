const { getPool } = require('./config/database');
async function fixModulos() {
    const pool = getPool();
    try {
        const [rows] = await pool.query("SELECT id FROM modulos WHERE UPPER(descricao) = 'FINANCEIRO'");
        if (rows.length === 0) {
            console.log('Criando módulo FINANCEIRO...');
            await pool.query("INSERT INTO modulos (descricao, liberado, excluido) VALUES ('Financeiro', 'S', 'N')");
        } else {
            console.log('Habilitando módulo FINANCEIRO...');
            await pool.query("UPDATE modulos SET liberado = 'S', excluido = 'N' WHERE id = ?", [rows[0].id]);
        }
        console.log('Módulo Financeiro pronto!');
    } catch (err) {
        console.error('Erro ao fixar módulos:', err.message);
    } finally {
        process.exit();
    }
}
fixModulos();
