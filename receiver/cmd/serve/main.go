package main

import (
	"receiver"
)

func main() {
	server := receiver.NewServer()
	server.Start()
}
