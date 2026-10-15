import importlib.util
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location('prospect_quality_eval', Path(__file__).parents[1] / 'scripts' / 'prospect_quality_eval.py')
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_inconclusive_is_not_counted_as_confirmed_and_recall_is_sample_only():
    labels = [{'id': str(i), 'review_status': status} for i, status in enumerate(['confirmed', 'invalid', 'inconclusive', 'confirmed'])]
    result = evaluation.measure(labels, {'0', '1', '2'})
    assert result['precision_on_conclusive_reviews'] == .5
    assert result['confirmed_share_of_all_accepted'] == 1 / 3
    assert result['precision_upper_if_all_inconclusive_are_valid'] == 2 / 3
    assert result['recall_within_reviewed_sample'] == .5


def test_no_accepted_candidates_has_no_precision_instead_of_perfect_score():
    result = evaluation.measure([{'id': 'a', 'review_status': 'invalid'}], set())
    assert result['precision_on_conclusive_reviews'] is None
    assert result['confirmed_share_of_all_accepted'] is None
    assert result['recall_within_reviewed_sample'] is None


@pytest.mark.parametrize('labels, accepted', [
    ([{'id': 'a', 'review_status': 'confirmed'}], {'unknown'}),
    ([{'id': 'a', 'review_status': 'confirmed'}] * 2, {'a'}),
    ([{'id': 'a', 'review_status': 'unknown'}], {'a'}),
])
def test_invalid_reviews_cannot_silently_inflate_metrics(labels, accepted):
    with pytest.raises(ValueError):
        evaluation.measure(labels, accepted)
