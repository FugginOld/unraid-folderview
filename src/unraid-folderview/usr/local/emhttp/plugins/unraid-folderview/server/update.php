<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    fv2_require_csrf();
    updateFolder($_POST['type'] ?? '', $_POST['content'] ?? '', $_POST['id'] ?? '');
?>
