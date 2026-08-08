#!/bin/bash

CWD=`pwd`

rm -Rf $CWD/src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/*
cp /usr/local/emhttp/plugins/unraid-folderview/* $CWD/src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview -R -v -p
chmod -R 0755 ./
chown -R root:root ./