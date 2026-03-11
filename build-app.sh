#!/usr/bin/env bash
set -e

APP_NAME="penguinmod-desktop"
BUILD_DIR="$(pwd)/builds"

echo "=== Cleaning old builds ==="
rm -rf packager-app app/build linux-base windows-base penguinmod.github.io "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "=== Cloning PenguinMod GUI ==="
export NODE_OPTIONS=--openssl-legacy-provider
git clone --depth=1 https://github.com/PenguinMod/penguinmod.github.io
cd penguinmod.github.io
git pull
rm package-lock.json
bun i --force

echo "=== Adding VM ==="
git clone --depth=1 https://github.com/PenguinMod/PenguinMod-Vm
cd PenguinMod-Vm
git pull
bun i --force
cd ..
cp -R PenguinMod-Vm node_modules
rm -rf node_modules/scratch-vm
mv node_modules/PenguinMod-Vm node_modules/scratch-vm

echo "=== Adding Blocks ==="
git clone --depth=1 -b develop-builds https://github.com/PenguinMod/PenguinMod-Blocks
cd PenguinMod-Blocks
git pull
bun i --force
cd ..
cp -R PenguinMod-Blocks node_modules
rm -rf node_modules/scratch-blocks
mv node_modules/PenguinMod-Blocks node_modules/scratch-blocks

echo "=== Adding Renderer ==="
git clone --depth=1 https://github.com/PenguinMod/PenguinMod-Render
cd PenguinMod-Render
git pull
bun i --force
cd ..
cp -R PenguinMod-Render node_modules
rm -rf node_modules/scratch-render
mv node_modules/PenguinMod-Render node_modules/scratch-render

echo "=== Adding Paint ==="
git clone --depth=1 https://github.com/PenguinMod/PenguinMod-Paint
cd PenguinMod-Paint
git pull
bun i --force
cd ..
cp -R PenguinMod-Paint node_modules
rm -rf node_modules/scratch-paint
mv node_modules/PenguinMod-Paint node_modules/scratch-paint

echo "=== Building PenguinMod ==="
NODE_ENV="production" bun run --silent build
cp -R build ../app
cd ..
mkdir -p app/node_modules
cp -R node_modules/deasync app/node_modules/

#echo "=== Packaging all platforms with electron-builder ==="
#bun exec electron-builder --config electron-builder.json

#echo "=== All builds complete! ==="
#ls -lh "$BUILD_DIR"
