<?php
    // POST only. A GET that mutates is reachable from an <img src> on any page a
    // logged-in admin visits; the CSRF guard is what makes the method change matter.
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    fv2_require_csrf();
    deleteFolder($_POST['type'] ?? '', $_POST['id'] ?? '');
?>
