package main

import "testing"

func TestRequestFormats(t *testing.T) {
	for _, line := range []string{
		`{"ts":1,"status":200,"duration":0.02,"size":42,"request":{"headers":{"X-Bench-Kind":["return"],"X-Bench-Step":["fixed"]}}}`,
		`{"target":"snowtime_bench","fields":{"ts":1,"kind":"return","step":"fixed","status":200,"duration":0.02,"size":42}}`,
	} {
		got, ok := requestFromLine([]byte(line))
		want := Request{1, "return", "fixed", 200, 0.02, 42}
		if !ok || got != want {
			t.Fatalf("got %+v (%v), want %+v", got, ok, want)
		}
	}
	for _, line := range []string{`invalid`, `{}`, `{"target":"snowtime_bench","fields":{"status":200,"kind":""}}`} {
		if _, ok := requestFromLine([]byte(line)); ok {
			t.Fatalf("unexpected request: %s", line)
		}
	}
}
