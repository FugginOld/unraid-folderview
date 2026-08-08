<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    echo json_encode(readInfo($_GET['type']));
?>