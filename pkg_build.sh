#!/bin/bash

CWD=`pwd`
tmpdir="$CWD/tmp/tmp.$((RANDOM % 1000000))"
version=$(date +"%Y.%m.%d")
filename="$CWD/archive/unraid-folderview-$version.txz"
plgfile="$CWD/unraid-folderview.plg"
dayversion=$(ls $CWD/archive/unraid-folderview-$version*.txz 2>/dev/null | wc -l)

if [ $dayversion -gt 0 ]
then
    version="$version.$dayversion"
    filename="$CWD/archive/unraid-folderview-$version.txz"
fi

mkdir -p $tmpdir
chmod 0755 -R .

cd "$CWD/src/unraid-folderview"
cp --parents -f $(find . -type f ! \( -iname "pkg_build.sh" -o -iname "sftp-config.json"  \) ) $tmpdir/

cd $tmpdir
# --mode/--owner/--group make the package identical regardless of the build host,
# so it no longer depends on the repo-wide chmod above or on building as root.
tar --mode=0755 --owner=0 --group=0 -cJf $filename *

cd $CWD
md5=$(md5sum $filename | awk '{print $1}')

# Update version and md5 in plg file
sed -i "s/<!ENTITY version.*>/<!ENTITY version \"$version\">/" $plgfile
sed -i "s/<!ENTITY md5.*>/<!ENTITY md5 \"$md5\">/" $plgfile

rm -R $CWD/tmp
chmod 0755 -R .

echo "Package created: $filename"
echo "Version: $version"
echo "MD5: $md5"
echo "PLG file updated"