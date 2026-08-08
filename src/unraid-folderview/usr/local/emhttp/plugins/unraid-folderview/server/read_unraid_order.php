<?php
  require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
  echo json_encode(readUnraidOrder($_GET['type']));
?>