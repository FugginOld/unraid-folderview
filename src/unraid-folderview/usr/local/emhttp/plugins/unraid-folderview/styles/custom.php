<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    $styles = dirToArrayOfFiles(pathToMultiDimArray('/boot/config/plugins/unraid-folderview/styles'), "/\..*{$type}.*\.css$/", "/.*\.disabled$/");
    foreach ($styles as $style) {
        echo "<link rel=\"stylesheet\" href=\"";
        autov($style['path']);
        echo  "\">";
    }
?>