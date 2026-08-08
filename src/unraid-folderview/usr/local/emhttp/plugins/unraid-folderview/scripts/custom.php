<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    $scripts = dirToArrayOfFiles(pathToMultiDimArray('/boot/config/plugins/unraid-folderview/scripts'), "/\..*{$type}.*\.js$/", "/.*\.disabled$/");
    foreach ($scripts as $script) {
        echo "<script src=\"";
        autov($script['path']);
        echo "\"></script>";
    }
?>