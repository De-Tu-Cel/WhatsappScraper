"""Evaluation must not reward fallback labels or score uncertain references."""
from scripts.classifier_quality_eval import metrics


def test_ambiguous_references_are_excluded_and_errors_are_incorrect():
    labels = {
        'confirmed': {'label': 'humano', 'confidence': 'clear'},
        'fallback': {'label': 'humano', 'confidence': 'clear'},
        'uncertain': {'label': None, 'confidence': 'ambiguous'},
    }
    rows = [
        {'id': 'confirmed', 'hibrido': {'common': 'humano'}},
        {'id': 'fallback', 'hibrido': {'common': 'humano', 'error': True}},
        {'id': 'uncertain', 'hibrido': {'common': 'bot'}},
    ]
    result = metrics(rows, labels, 'hibrido')
    assert result['n'] == 2
    assert result['correct'] == 1
    assert result['accuracy'] == 0.5
    assert result['per_category']['humano']['recall'] == 0.5


def test_timing_compatibility_is_separate_from_exact_accuracy():
    labels = {'a': {'label': 'humano', 'confidence': 'clear'}}
    rows = [{'id': 'a', 'timing': {'common': 'humano_o_desconectado'}}]
    result = metrics(rows, labels, 'timing')
    assert result['accuracy'] == 0
    assert result['compatible'] == 1
