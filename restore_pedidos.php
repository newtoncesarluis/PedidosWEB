<?php
$source = 'c:/xampp/htdocs/SysRepWeb/public/pages/pedidos - Copia.html';
$dest = 'c:/xampp/htdocs/SysRepWeb/public/pages/pedidos.html';
if (copy($source, $dest)) {
    echo "SUCCESS: Restored from backup.";
} else {
    echo "ERROR: Failed to restore.";
}
?>
