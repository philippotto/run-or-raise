# Run "make" to compile the extension locally.
# Run "make install" to install it for the current user.
# Run "make release" to bump the version number and push a tag.
# Or "make commit-and-release" to commit the staged changes, alongside bumping the version number.
# Then GitHub Actions will publish to the extension store.

UUID ?= run-or-raise@edvard.cz
# a version above any release keeps extensions.gnome.org from replacing a local install
VERSION ?= 9999
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

all: compile build

compile:
	glib-compile-schemas schemas

build:
	./scripts/pack.sh

install: all
	gnome-extensions install -f build/$(UUID).shell-extension.zip
	glib-compile-schemas $(INSTALL_DIR)/schemas
	jq '.version = $(VERSION)' $(INSTALL_DIR)/metadata.json > $(INSTALL_DIR)/metadata.json.tmp
	mv $(INSTALL_DIR)/metadata.json.tmp $(INSTALL_DIR)/metadata.json

test:
	npm test

release:
	./scripts/release.sh

commit-and-release:
	./scripts/release.sh --commit

.PHONY: all compile build install test release commit-and-release
