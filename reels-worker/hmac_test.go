package main

import "testing"

func TestMakeSignatureCanonicalVector(t *testing.T) {
	got := makeSignature("test-secret", "1700000000", "{\"media\":[]}")
	want := "25ceef37e1f9f913ce4d986dafc207764001ab51ed1c4b101b84d72f1222771a"
	if got != want {
		t.Fatalf("signature mismatch: got %s want %s", got, want)
	}
}
